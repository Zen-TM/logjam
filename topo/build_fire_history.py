#!/usr/bin/env python3
"""
build_fire_history.py
----------------------
One-off preprocessing: rasterize the NSW NPWS Fire History polygon shapefile
into a "most-recent fire year" GeoTIFF. Each output cell holds the most
recent calendar year in which that ground was known to have burned, or 0
(nodata) if the ground has never burned or has no usable date on record.

Input  : NPWS Fire History ESRI shapefile (.shp + sidecars), NOT committed —
         the raw NPWS export lives outside the repo (see topo/CLAUDE.md fire-
         history convention). Pass its path via --input.
Outputs: topo/fire/fire_history_year.tif        (uint16, EPSG:3577, 25 m)
         topo/fire/fire_history_year_legend.json (provenance + year range)

Source & licence: NPWS Fire History - Wildfires and Prescribed Burns, from
         The Sharing and Enabling Environmental Data (SEED) Portal
         (https://datasets.seed.nsw.gov.au/dataset/fire-history-wildfires-and-prescribed-burns-1e8b6).
         Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
         Required attribution: "© State Government of NSW and NSW Department
         of Climate Change, Energy, the Environment and Water 2010". This
         credit must accompany any derived output (this raster, and the
         fire-staleness hatch it drives in the vegetation layer) wherever
         shared — see topo/README.md "Data sources & licences" and
         shared/src/geoPdfBaseLayers.ts (GEOPDF_OVERLAY_ATTRIBUTION.vegetation)
         for where it is surfaced in-app and in exported GeoPDFs.

Run this once whenever the raw NPWS Fire History shapefile is updated. The
topo job pipeline loads the derived year raster — never the raw shapefile —
at job time. Re-upload to S3 and wire into pipeline.py are handled separately
by whoever consumes this output; this script only produces the local files.
"""

import argparse
import json
import math
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import List, Optional, Set, Tuple

from osgeo import gdal, ogr, osr

gdal.UseExceptions()
ogr.UseExceptions()

TARGET_EPSG = 3577          # GDA94 / Australian Albers — metric, equal-area
# 100 m is deliberate: the raster only drives a per-cell "burned since LiDAR
# capture" stale FLAG (warped onto the job DTM at apply time), not a precise
# fire boundary. Fires are large-area, the LiDAR AOIs are small, and a ~100 m
# boundary slop is irrelevant to the flag — while 25 m over all-NSW is 2.6e9
# cells and ~80 per-year rasterize passes (minutes-to-tens-of-minutes + GBs).
RASTER_RESOLUTION_M = 100
NODATA_VALUE = 0             # 0 = never-burned or no usable date on record
MIN_VALID_YEAR = 1900        # rejects the 1899-12-30 NPWS null-sentinel


def resolve_fire_year(
    start_date: Optional[date],
    end_date: Optional[date],
    current_year: int,
) -> Optional[int]:
    """Map one feature's (StartDate, EndDate) to a valid fire year, or None.

    Coalesces EndDate -> StartDate: EndDate is preferred when present (it's
    the more precise "fire out" date), falling back to StartDate when the
    fire is still recorded as unclosed. Returns None — meaning "drop this
    feature, it carries no usable fire date" — unless the chosen date exists
    and its year is in [1900, current_year]. That range rejects three known
    data-quality issues in the NPWS export: the 1899-12-30 null-sentinel used
    in place of a real missing date, at least one outright bogus pre-1900
    date (e.g. 1807), and any date recorded in the future.

    Pure stdlib-only logic — no GDAL/OGR — so it unit-tests on any host.
    """
    fire_date = end_date if end_date is not None else start_date
    if fire_date is None:
        return None
    year = fire_date.year
    if year < MIN_VALID_YEAR or year > current_year:
        return None
    return year


def _ogr_field_to_date(feature: "ogr.Feature", field_index: int) -> Optional[date]:
    """Read an OGR Date field as a python date, or None if unset/null.

    OGR distinguishes "field not set" from "field set to a nonsense date"
    (like the 1899-12-30 sentinel) — IsFieldSetAndNotNull() handles the
    former, resolve_fire_year()'s range check handles the latter.
    """
    if not feature.IsFieldSetAndNotNull(field_index):
        return None
    year, month, day, _hour, _minute, _second, _tz_flag = feature.GetFieldAsDateTime(field_index)
    return date(year, month, day)


def compute_reprojected_extent(
    src_layer: "ogr.Layer", transform: "osr.CoordinateTransformation"
) -> Tuple[float, float, float, float]:
    """Reproject the source layer's full extent (all features) into the
    target CRS by transforming its four bounding-box corners.

    Returns (xmin, xmax, ymin, ymax) in the target CRS.
    """
    minx, maxx, miny, maxy = src_layer.GetExtent()
    corners = [(minx, miny), (minx, maxy), (maxx, miny), (maxx, maxy)]
    xs: List[float] = []
    ys: List[float] = []
    for lon, lat in corners:
        x, y, _z = transform.TransformPoint(lon, lat)
        xs.append(x)
        ys.append(y)
    return min(xs), max(xs), min(ys), max(ys)


def build_valid_year_layer(
    src_layer: "ogr.Layer",
    transform: "osr.CoordinateTransformation",
    tgt_srs: "osr.SpatialReference",
    current_year: int,
):
    """Copy every feature with a resolvable fire year into a new in-memory
    layer, geometry reprojected to the target CRS, carrying a "fire_year"
    integer attribute. Features with no valid year are dropped here — before
    rasterizing, per the fire-history preprocess spec.

    Returns (mem_ds, mem_layer, valid_count, dropped_count, years_seen).
    mem_ds is returned alongside mem_layer and must be kept alive by the
    caller for as long as mem_layer is used — OGR's Python bindings don't
    keep a Layer's parent DataSource alive on their own, so letting mem_ds
    go out of scope corrupts the returned layer.
    """
    layer_defn = src_layer.GetLayerDefn()
    start_idx = layer_defn.GetFieldIndex("StartDate")
    end_idx = layer_defn.GetFieldIndex("EndDate")
    if start_idx < 0 or end_idx < 0:
        raise ValueError(
            "Source layer is missing StartDate/EndDate fields — "
            f"found fields: {[layer_defn.GetFieldDefn(i).GetName() for i in range(layer_defn.GetFieldCount())]}"
        )

    mem_driver = ogr.GetDriverByName("MEM")
    mem_ds = mem_driver.CreateDataSource("fire_history_valid")
    mem_layer = mem_ds.CreateLayer("fire_valid", srs=tgt_srs, geom_type=ogr.wkbUnknown)
    mem_layer.CreateField(ogr.FieldDefn("fire_year", ogr.OFTInteger))
    mem_layer_defn = mem_layer.GetLayerDefn()

    valid_count = 0
    dropped_count = 0
    years_seen: Set[int] = set()

    src_layer.ResetReading()
    for i, feature in enumerate(src_layer):
        if i and i % 5000 == 0:
            print(f"  scanned {i} features …", flush=True)

        start = _ogr_field_to_date(feature, start_idx)
        end = _ogr_field_to_date(feature, end_idx)
        year = resolve_fire_year(start, end, current_year)
        if year is None:
            dropped_count += 1
            continue

        geom = feature.GetGeometryRef()
        if geom is None:
            dropped_count += 1
            continue

        geom_clone = geom.Clone()
        geom_clone.Transform(transform)

        out_feature = ogr.Feature(mem_layer_defn)
        out_feature.SetGeometry(geom_clone)
        out_feature.SetField("fire_year", year)
        mem_layer.CreateFeature(out_feature)

        valid_count += 1
        years_seen.add(year)

    return mem_ds, mem_layer, valid_count, dropped_count, years_seen


def rasterize_max_year(
    mem_layer: "ogr.Layer",
    years_seen: Set[int],
    extent: Tuple[float, float, float, float],
    tgt_srs: "osr.SpatialReference",
    out_path: str,
):
    """Burn the reprojected, per-feature fire_year attribute into a single
    uint16 band, one distinct year at a time, oldest first.

    RasterizeLayer's ATTRIBUTE burn mode does not guarantee draw order
    matches attribute value across a single call — feature order in the
    source file drives it, not the year. To guarantee "most recent fire
    wins" per cell, we instead call RasterizeLayer once per distinct year,
    ascending, with a constant burn value and an attribute filter restricting
    each call to that year's polygons. Each pass overwrites only the cells
    its polygons cover, so the newest year drawn last always wins ties.
    """
    xmin, xmax, ymin, ymax = extent
    width = int(math.ceil((xmax - xmin) / RASTER_RESOLUTION_M))
    height = int(math.ceil((ymax - ymin) / RASTER_RESOLUTION_M))

    driver = gdal.GetDriverByName("GTiff")
    dst_ds = driver.Create(
        out_path,
        width,
        height,
        1,
        gdal.GDT_UInt16,
        options=["COMPRESS=LZW", "PREDICTOR=2", "TILED=YES", "BIGTIFF=YES"],
    )
    dst_ds.SetGeoTransform((xmin, RASTER_RESOLUTION_M, 0, ymax, 0, -RASTER_RESOLUTION_M))
    dst_ds.SetProjection(tgt_srs.ExportToWkt())
    band = dst_ds.GetRasterBand(1)
    band.SetNoDataValue(NODATA_VALUE)
    band.Fill(NODATA_VALUE)

    for year in sorted(years_seen):
        mem_layer.SetAttributeFilter(f"fire_year = {year}")
        gdal.RasterizeLayer(dst_ds, [1], mem_layer, burn_values=[year])
        print(f"  burned year {year} ({mem_layer.GetFeatureCount()} polygons)", flush=True)
    mem_layer.SetAttributeFilter(None)

    dst_ds.FlushCache()
    dst_ds = None

    return width, height


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    here = Path(__file__).parent
    parser.add_argument(
        "--input",
        required=True,
        help="Path to the raw NPWS Fire History shapefile (.shp). Not committed to the repo.",
    )
    parser.add_argument(
        "--output",
        default=str(here / "fire" / "fire_history_year.tif"),
        help="Output fire-year raster path.",
    )
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"ERROR: input shapefile not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    out_path = Path(args.output)
    legend_path = out_path.with_name(out_path.stem + "_legend.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Opening: {args.input}")
    src_ds = ogr.Open(args.input)
    if src_ds is None:
        print(f"ERROR: OGR could not open {args.input}", file=sys.stderr)
        sys.exit(1)
    src_layer = src_ds.GetLayer(0)
    src_srs = src_layer.GetSpatialRef()
    if src_srs is None:
        print("ERROR: source layer has no spatial reference defined", file=sys.stderr)
        sys.exit(1)
    print(f"  {src_layer.GetFeatureCount()} features, source SRS: {src_srs.GetAuthorityCode(None)}")

    tgt_srs = osr.SpatialReference()
    tgt_srs.ImportFromEPSG(TARGET_EPSG)
    src_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    tgt_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    transform = osr.CoordinateTransformation(src_srs, tgt_srs)

    current_year = datetime.now(timezone.utc).year
    print(f"Resolving fire years (current_year={current_year}, valid range [{MIN_VALID_YEAR}, {current_year}]) …")
    mem_ds, mem_layer, valid_count, dropped_count, years_seen = build_valid_year_layer(
        src_layer, transform, tgt_srs, current_year
    )
    print(f"  {valid_count} valid, {dropped_count} dropped (no usable fire date)")
    if not years_seen:
        print("ERROR: zero features had a resolvable fire year — nothing to rasterize", file=sys.stderr)
        sys.exit(1)
    print(f"  {len(years_seen)} distinct fire years, {min(years_seen)}–{max(years_seen)}")

    print(f"Computing reprojected extent (EPSG:{TARGET_EPSG}) …")
    extent = compute_reprojected_extent(src_layer, transform)
    print(f"  extent (xmin, xmax, ymin, ymax): {extent}")

    print(f"Rasterizing → {out_path} (uint16, {RASTER_RESOLUTION_M} m, nodata={NODATA_VALUE}) …")
    width, height = rasterize_max_year(mem_layer, years_seen, extent, tgt_srs, str(out_path))
    print(f"  raster size: {width} x {height}")

    legend = {
        "description": (
            "NPWS Fire History → most-recent-fire-year raster. Pixel value is "
            "the most recent calendar year known to have burned that ground; "
            "0 (nodata) means never-burned or no usable date on record."
        ),
        "source_file": os.path.basename(args.input),
        "build_date_utc": datetime.now(timezone.utc).isoformat(),
        "crs": f"EPSG:{TARGET_EPSG}",
        "resolution_m": RASTER_RESOLUTION_M,
        "nodata": NODATA_VALUE,
        "min_fire_year": min(years_seen),
        "max_fire_year": max(years_seen),
        "valid_feature_count": valid_count,
        "dropped_feature_count": dropped_count,
        "total_feature_count": valid_count + dropped_count,
    }
    with open(legend_path, "w") as f:
        json.dump(legend, f, indent=2)
    print(f"Wrote legend → {legend_path}")
    print("Done.")


if __name__ == "__main__":
    main()
