#!/usr/bin/env python3
"""
build_svtm_formation.py
-----------------------
One-off preprocessing: collapse the SVTM PCT raster (1687 distinct Plant
Community Types, uint16) into a vegetation-*formation* raster (~17 classes,
uint8) using the formation labels from the raster's .vat.dbf attribute table.

Input  : topo/SVTM/SVTM_NSW_Extant_PCT_vC2_0_M2_2_5m.tif (+ .vat.dbf)
Outputs: topo/SVTM/svtm_formation.tif         (uint8, same grid as input)
         topo/SVTM/svtm_formation_legend.json (formation index → name + μ)

Run this once whenever the SVTM raw raster is updated. The topo pipeline
loads the formation raster — not the full PCT raster — at job time.
"""

import argparse
import json
import os
import struct
import sys
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
from osgeo import gdal

gdal.UseExceptions()

# Formation → navigational-resistance multiplier μ. Multiplies the structural
# NRD value to lift hard/thorny vegetation up and soften clear-floored forests.
# Heuristic starting values — calibrate against ground truth when available.
SVTM_FORMATION_MU: Dict[str, float] = {
    "Rainforests":                                         0.7,
    "Wet Sclerophyll Forests (Grassy sub-formation)":      0.9,
    "Wet Sclerophyll Forests (Shrubby sub-formation)":     1.2,
    "Dry Sclerophyll Forests (Shrub/grass sub-formation)": 1.2,
    "Dry Sclerophyll Forests (Shrubby sub-formation)":     1.5,
    "Grassy Woodlands":                                    0.7,
    "Grasslands":                                          0.5,
    "Heathlands":                                          1.8,
    "Forested Wetlands":                                   1.1,
    "Freshwater Wetlands":                                 1.3,
    "Saline Wetlands":                                     1.0,
    "Semi-arid Woodlands (Grassy sub-formation)":          0.9,
    "Semi-arid Woodlands (Shrubby sub-formation)":         1.3,
    "Arid Shrublands (Acacia sub-formation)":              1.4,
    "Arid Shrublands (Chenopod sub-formation)":            1.0,
    "Alpine Complex":                                      1.4,
    "Not classified":                                      1.0,
}


def read_vat_dbf(dbf_path: str) -> List[Dict[str, str]]:
    """Parse the .vat.dbf attribute table into a list of dict rows.

    Hand-rolled because pulling in dbfread/simpledbf for a single read isn't
    worth a new dependency. dBASE III format: 32-byte header, 32-byte per
    field descriptor terminated by 0x0d, then fixed-length records.
    """
    with open(dbf_path, "rb") as f:
        header = f.read(32)
        n_records  = struct.unpack("<L", header[4:8])[0]
        header_len = struct.unpack("<H", header[8:10])[0]
        record_len = struct.unpack("<H", header[10:12])[0]

        fields = []
        while True:
            b = f.read(32)
            if not b or b[0:1] == b"\x0d":
                break
            name = b[0:11].split(b"\x00")[0].decode("latin-1")
            flen = b[16]
            fields.append((name, flen))

        f.seek(header_len)
        rows = []
        for _ in range(n_records):
            rec = f.read(record_len)
            if not rec or rec[0:1] == b"*":   # deleted flag
                continue
            offset = 1
            row = {}
            for name, flen in fields:
                row[name] = rec[offset:offset + flen].decode("latin-1", errors="replace").strip()
                offset += flen
            rows.append(row)
        return rows


def build_formation_mapping(vat_rows: List[Dict[str, str]]) -> Tuple[np.ndarray, List[str]]:
    """
    Return (value→formation_index lookup array, formation list).

    Lookup array is sized [max_value+1] so a simple numpy fancy-index
    over the PCT raster produces the formation index raster in one pass.
    """
    formations: List[str] = []
    formation_to_idx: Dict[str, int] = {}

    # Ensure "Not classified" is index 0 for the nodata-default case.
    formations.append("Not classified")
    formation_to_idx["Not classified"] = 0

    max_value = max(int(r["Value"]) for r in vat_rows)
    lookup = np.zeros(max_value + 1, dtype=np.uint8)

    for r in vat_rows:
        val = int(r["Value"])
        form = r["vegForm"] or "Not classified"
        if form not in formation_to_idx:
            if form not in SVTM_FORMATION_MU:
                raise ValueError(
                    f"vegForm {form!r} is missing from SVTM_FORMATION_MU. "
                    f"Add a μ value before re-running."
                )
            formation_to_idx[form] = len(formations)
            formations.append(form)
        lookup[val] = formation_to_idx[form]

    return lookup, formations


def remap_pct_raster(src_path: str, lookup: np.ndarray, dst_path: str):
    """Apply the PCT→formation lookup tile-by-tile to keep memory bounded."""
    src_ds = gdal.Open(src_path)
    src_band = src_ds.GetRasterBand(1)
    src_nodata = src_band.GetNoDataValue()
    width  = src_ds.RasterXSize
    height = src_ds.RasterYSize

    driver = gdal.GetDriverByName("GTiff")
    dst_ds = driver.Create(
        dst_path, width, height, 1, gdal.GDT_Byte,
        options=["COMPRESS=LZW", "PREDICTOR=2", "TILED=YES", "BIGTIFF=IF_SAFER"],
    )
    dst_ds.SetGeoTransform(src_ds.GetGeoTransform())
    dst_ds.SetProjection(src_ds.GetProjection())
    dst_band = dst_ds.GetRasterBand(1)
    dst_band.SetNoDataValue(255)   # reserve 255 as "unmapped" formation

    block_x = 2048
    block_y = 2048
    for yoff in range(0, height, block_y):
        rows = min(block_y, height - yoff)
        for xoff in range(0, width, block_x):
            cols = min(block_x, width - xoff)
            arr = src_band.ReadAsArray(xoff, yoff, cols, rows)
            # Clamp out-of-range or nodata values to "Not classified" (index 0)
            if src_nodata is not None:
                nodata_mask = (arr == src_nodata)
            else:
                nodata_mask = np.zeros_like(arr, dtype=bool)
            arr_clipped = np.where(arr < len(lookup), arr, 0)
            mapped = lookup[arr_clipped]
            mapped[nodata_mask] = 0
            dst_band.WriteArray(mapped, xoff, yoff)
        print(f"  row {yoff + rows}/{height}", flush=True)

    dst_ds.FlushCache()
    dst_ds = None
    src_ds = None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    here = Path(__file__).parent
    parser.add_argument(
        "--svtm-raster",
        default=str(here / "SVTM" / "SVTM_NSW_Extant_PCT_vC2_0_M2_2_5m.tif"),
        help="Path to the raw SVTM PCT raster.",
    )
    parser.add_argument(
        "--out-raster",
        default=str(here / "SVTM" / "svtm_formation.tif"),
        help="Output formation raster path.",
    )
    parser.add_argument(
        "--out-legend",
        default=str(here / "SVTM" / "svtm_formation_legend.json"),
        help="Output legend JSON path.",
    )
    args = parser.parse_args()

    if not os.path.exists(args.svtm_raster):
        print(f"ERROR: SVTM raster not found: {args.svtm_raster}", file=sys.stderr)
        sys.exit(1)
    vat_path = args.svtm_raster + ".vat.dbf"
    if not os.path.exists(vat_path):
        print(f"ERROR: VAT .dbf not found: {vat_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Reading VAT: {vat_path}")
    rows = read_vat_dbf(vat_path)
    print(f"  {len(rows)} attribute rows")

    print("Building PCT → formation lookup …")
    lookup, formations = build_formation_mapping(rows)
    print(f"  {len(formations)} distinct formations")
    for i, name in enumerate(formations):
        mu = SVTM_FORMATION_MU[name]
        print(f"    {i:3d}  μ={mu:.2f}  {name}")

    print(f"Remapping raster → {args.out_raster}")
    remap_pct_raster(args.svtm_raster, lookup, args.out_raster)

    legend = {
        "description": "SVTM formation raster: pixel value → vegetation formation + navigational resistance μ.",
        "nodata": 255,
        "formations": [
            {"index": i, "name": name, "mu": SVTM_FORMATION_MU[name]}
            for i, name in enumerate(formations)
        ],
    }
    with open(args.out_legend, "w") as f:
        json.dump(legend, f, indent=2)
    print(f"Wrote legend → {args.out_legend}")
    print("Done.")


if __name__ == "__main__":
    main()
