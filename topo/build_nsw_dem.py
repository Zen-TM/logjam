#!/usr/bin/env python3
"""
build_nsw_dem.py
----------------
One-off build of the `nsw-5m` DEM archive from the NSW Spatial Services 5 m
DEM sheets: terrarium PNG tiles, 256 px, zoom 8 to 15, heights rounded to a
quarter of a metre, in one PMTiles file.
docs/decisions/0029-dem-tiles-are-terrarium-png-in-pmtiles.md

    build_nsw_dem.py fetch SRC [Sheet ...]     # no sheet named = all 343
    build_nsw_dem.py tile  SRC WORK [--jobs N]
    build_nsw_dem.py pack  WORK OUT.pmtiles --extracted "October 2026"

`fetch` and `tile` skip what is already done, so a killed run restarts where
it stopped. Run `tile` only once every sheet is fetched: a finished block is
not rebuilt when a neighbouring sheet arrives later. `pack` needs the
`pmtiles` binary (go-pmtiles) on PATH, and stamps the archive with the month
the sheets were downloaded, which the data's licence asks derived products to
show (docs/decisions/0030-nsw-heights-come-from-the-spatial-services-5m-dem.md).

The work unit is one zoom-10 tile (a "block", about 33 km across here), NOT
one sheet: sheets are in three MGA zones and a tile on a sheet edge needs
both neighbours, so each block is warped from every sheet that touches it.

Heights are averaged down for each coarser zoom BEFORE encoding. Averaging
the encoded RGB instead is wrong: it is not a linear encoding per channel.
"""

import argparse
import io
import json
import math
import os
import shutil
import sqlite3
import subprocess
import sys
import urllib.parse
import urllib.request
from multiprocessing import Pool
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

import numpy as np
from osgeo import gdal, osr
from PIL import Image

gdal.UseExceptions()

TILE = 256
ZMAX = 15  # a z15 pixel is ~4 m here: the first zoom finer than the 5 m data
ZMIN = 8
BLOCK_ZOOM = 10
BLOCK_TILES = 2 ** (ZMAX - BLOCK_ZOOM)  # z15 tiles along one block edge
# Finer steps cost bytes and buy nothing: the publisher states +/-0.9 m on
# open ground. At 1/8 m a rugged tile is ~22 % larger.
ROUNDING_M = 0.25
NODATA = -9999.0
# The widest gap interpolated across, in z15 pixels (~4 m each). Enough for
# the join between two sheets; a real hole in the data is far wider and stays.
SEAM_FILL_PX = 4
HALF_WORLD_M = 20037508.342789244

INDEX_URL = (
    "https://portal.spatial.nsw.gov.au/server/rest/services/Hosted/"
    "Elevation_Index_Public/FeatureServer/0/query"
)
SHEET_URL = "https://portal.spatial.nsw.gov.au/download/dem/{zone}/{sheet}.zip"


# ── Pure pieces (topo/tests/test_nsw_dem.py) ─────────────────────────────────


def encode_terrarium(heights: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Heights (m) to terrarium RGB, rounded to ROUNDING_M.

    A no-data pixel is (0, 0, 0), which decodes to -32768 m: the value
    `demSampleHeight` in shared/src/demTiles.ts reads as "no height here".
    """
    rounded = np.round(heights / ROUNDING_M) * ROUNDING_M
    v = np.where(valid, rounded + 32768.0, 0.0)
    r = np.floor(v / 256)
    g = np.floor(v - r * 256)
    b = np.floor((v - r * 256 - g) * 256)
    return np.dstack([r, g, b]).astype(np.uint8)


def halve(heights: np.ndarray) -> np.ndarray:
    """The next coarser zoom: the mean of each 2x2, ignoring no-data (NaN)."""
    h, w = heights.shape
    quads = (
        heights.reshape(h // 2, 2, w // 2, 2).swapaxes(1, 2).reshape(h // 2, w // 2, 4)
    )
    known = ~np.isnan(quads)
    count = known.sum(axis=2)
    total = np.where(known, quads, 0.0).sum(axis=2)
    return np.where(count > 0, total / np.maximum(count, 1), np.nan).astype(np.float32)


def tile_bounds_3857(z: int, x: int, y: int) -> Tuple[float, float, float, float]:
    """(west, south, east, north) of an XYZ tile, in web mercator metres."""
    span = 2 * HALF_WORLD_M / 2**z
    west = -HALF_WORLD_M + x * span
    north = HALF_WORLD_M - y * span
    return west, north - span, west + span, north


def lonlat_to_tile(lon: float, lat: float, z: int) -> Tuple[int, int]:
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def tile_lonlat(x: int, y: int, z: int) -> Tuple[float, float]:
    """The lon/lat of an XYZ tile's north-west corner."""
    n = 2**z
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return x / n * 360.0 - 180.0, lat


def blocks_for(extent: Tuple[float, float, float, float]) -> Iterator[Tuple[int, int]]:
    """Every block a (west, south, east, north) lon/lat extent touches."""
    west, south, east, north = extent
    x0, y0 = lonlat_to_tile(west, north, BLOCK_ZOOM)
    x1, y1 = lonlat_to_tile(east, south, BLOCK_ZOOM)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            yield x, y


def png_bytes(rgb: np.ndarray) -> bytes:
    out = io.BytesIO()
    Image.fromarray(rgb).save(out, "PNG", compress_level=9)
    return out.getvalue()


def tiles_of(heights: np.ndarray, z: int, x0: int, y0: int):
    """(z, x, y, png) for each tile of a square height grid that has a height."""
    for row in range(heights.shape[0] // TILE):
        for col in range(heights.shape[1] // TILE):
            h = heights[row * TILE : (row + 1) * TILE, col * TILE : (col + 1) * TILE]
            valid = ~np.isnan(h)
            if valid.any():
                yield z, x0 + col, y0 + row, png_bytes(encode_terrarium(h, valid))


# ── fetch ────────────────────────────────────────────────────────────────────


def sheet_index() -> List[Dict[str, str]]:
    query = urllib.parse.urlencode(
        {
            "where": "1=1",
            "outFields": "dems5mid,zone",
            "returnGeometry": "false",
            "f": "json",
        }
    )
    with urllib.request.urlopen(f"{INDEX_URL}?{query}", timeout=60) as response:
        features = json.load(response)["features"]
    return [f["attributes"] for f in features]


def fetch(src: Path, wanted: List[str]) -> None:
    src.mkdir(parents=True, exist_ok=True)
    sheets = sheet_index()
    if wanted:
        sheets = [s for s in sheets if s["dems5mid"].split("-")[0] in wanted]
    for n, sheet in enumerate(sheets, 1):
        name, zone = sheet["dems5mid"], sheet["zone"]
        out = src / f"{name}.tif"
        if out.exists():
            continue
        print(f"[{n}/{len(sheets)}] {name}", flush=True)
        zip_path = src / f"{name}.zip"
        urllib.request.urlretrieve(SHEET_URL.format(zone=zone, sheet=name), zip_path)
        tmp = src / f"{name}.tmp.tif"
        # The .asc carries no CRS: the zone is in the sheet's name only.
        gdal.Translate(
            str(tmp),
            f"/vsizip/{zip_path}/{name}.asc",
            outputSRS=f"EPSG:283{zone}",
            noData=NODATA,
            outputType=gdal.GDT_Float32,
            creationOptions=["COMPRESS=ZSTD", "PREDICTOR=3", "TILED=YES"],
        )
        tmp.rename(out)
        zip_path.unlink()


# ── tile ─────────────────────────────────────────────────────────────────────


def sheet_extent(path: Path) -> Tuple[float, float, float, float]:
    """A sheet's (west, south, east, north) in lon/lat."""
    ds = gdal.Open(str(path))
    gt = ds.GetGeoTransform()
    wgs84 = osr.SpatialReference()
    wgs84.ImportFromEPSG(4326)
    wgs84.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    to_lonlat = osr.CoordinateTransformation(ds.GetSpatialRef(), wgs84)
    xs = (gt[0], gt[0] + gt[1] * ds.RasterXSize)
    ys = (gt[3], gt[3] + gt[5] * ds.RasterYSize)
    corners = [to_lonlat.TransformPoint(x, y)[:2] for x in xs for y in ys]
    lons, lats = zip(*corners)
    return min(lons), min(lats), max(lons), max(lats)


def open_block_db(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.execute("create table tiles (z integer, x integer, y integer, data blob)")
    return db


def build_block(job: Tuple[int, int, List[str], str]) -> Optional[str]:
    bx, by, sheets, work = job
    done = Path(work) / f"{bx}-{by}.sqlite"
    if done.exists():
        return None
    west, south, east, north = tile_bounds_3857(BLOCK_ZOOM, bx, by)
    size = BLOCK_TILES * TILE
    warped = gdal.Warp(
        "",
        sheets,
        format="MEM",
        dstSRS="EPSG:3857",
        outputBounds=(west, south, east, north),
        width=size,
        height=size,
        resampleAlg="bilinear",
        outputType=gdal.GDT_Float32,
        srcNodata=NODATA,
        dstNodata=NODATA,
    )
    band = warped.GetRasterBand(1)
    # Neighbouring sheets do not quite meet: measured at 150°E, the last
    # heights of one and the first of the next are 5 to 9 m apart, which is a
    # strip of no-data two or three pixels wide along every sheet edge.
    gdal.FillNodata(band, None, SEAM_FILL_PX, 0)
    heights = band.ReadAsArray().astype(np.float32)
    warped = None
    heights[heights <= -1000] = np.nan

    tmp = Path(work) / f"{bx}-{by}.tmp"
    tmp.unlink(missing_ok=True)
    db = open_block_db(tmp)
    count = 0
    for z in range(ZMAX, BLOCK_ZOOM - 1, -1):
        scale = 2 ** (z - BLOCK_ZOOM)
        rows = list(tiles_of(heights, z, bx * scale, by * scale))
        db.executemany("insert into tiles values (?,?,?,?)", rows)
        count += len(rows)
        if z > BLOCK_ZOOM:
            heights = halve(heights)
    db.commit()
    db.close()
    # The block's own tile as heights, for `pack` to average into z9 and z8.
    np.save(Path(work) / f"{bx}-{by}.npy", heights)
    tmp.rename(done)
    return f"{bx}/{by}: {count} tiles from {len(sheets)} sheet(s)"


def tile(src: Path, work: Path, jobs: int) -> None:
    work.mkdir(parents=True, exist_ok=True)
    by_block: Dict[Tuple[int, int], List[str]] = {}
    for sheet in sorted(src.glob("*.tif")):
        for block in blocks_for(sheet_extent(sheet)):
            by_block.setdefault(block, []).append(str(sheet))
    todo = [
        (bx, by, sheets, str(work)) for (bx, by), sheets in sorted(by_block.items())
    ]
    print(f"{len(todo)} blocks", flush=True)
    with Pool(jobs) as pool:
        for n, line in enumerate(pool.imap_unordered(build_block, todo), 1):
            if line:
                print(f"[{n}/{len(todo)}] {line}", flush=True)


# ── pack ─────────────────────────────────────────────────────────────────────


def coarse_tiles(work: Path):
    """z9 and z8, averaged from the blocks' own z10 heights."""
    level: Dict[Tuple[int, int], np.ndarray] = {}
    for path in work.glob("*.npy"):
        bx, by = (int(n) for n in path.stem.split("-"))
        level[(bx, by)] = np.load(path)
    for z in range(BLOCK_ZOOM - 1, ZMIN - 1, -1):
        parents: Dict[Tuple[int, int], np.ndarray] = {}
        for px, py in {(x // 2, y // 2) for x, y in level}:
            quad = np.full((2 * TILE, 2 * TILE), np.nan, np.float32)
            for dx in (0, 1):
                for dy in (0, 1):
                    child = level.get((2 * px + dx, 2 * py + dy))
                    if child is not None:
                        quad[
                            dy * TILE : (dy + 1) * TILE, dx * TILE : (dx + 1) * TILE
                        ] = child
            parents[(px, py)] = halve(quad)
            yield from tiles_of(parents[(px, py)], z, px, py)
        level = parents


def pack(work: Path, out: Path, extracted: str) -> None:
    if not shutil.which("pmtiles"):
        sys.exit("pack needs the `pmtiles` binary (go-pmtiles) on PATH")
    mbtiles = out.with_suffix(".mbtiles")
    mbtiles.unlink(missing_ok=True)
    db = sqlite3.connect(mbtiles)
    db.execute(
        "create table tiles (zoom_level integer, tile_column integer,"
        " tile_row integer, tile_data blob)"
    )
    db.execute("create table metadata (name text, value text)")
    # MBTiles rows are TMS: flipped from the XYZ rows used everywhere else.
    flip = "insert into tiles values (?1, ?2, (1 << ?1) - 1 - ?3, ?4)"
    for block in sorted(work.glob("*.sqlite")):
        db.executemany(
            flip, sqlite3.connect(block).execute("select z, x, y, data from tiles")
        )
    db.executemany(flip, coarse_tiles(work))
    db.execute(
        "create unique index tile_index on tiles (zoom_level, tile_column, tile_row)"
    )
    # Without bounds a reader takes the archive to cover the world, and
    # `pmtiles extract` and MapLibre ask it for tiles it does not have.
    x0, x1, y0, y1 = db.execute(
        "select min(tile_column), max(tile_column), min(tile_row), max(tile_row)"
        " from tiles where zoom_level = ?",
        (ZMAX,),
    ).fetchone()
    west, south = tile_lonlat(x0, (1 << ZMAX) - y0, ZMAX)
    east, north = tile_lonlat(x1 + 1, (1 << ZMAX) - 1 - y1, ZMAX)
    metadata = {
        "bounds": f"{west},{south},{east},{north}",
        "center": f"{(west + east) / 2},{(south + north) / 2},{ZMIN}",
        "name": "NSW 5 m DEM",
        "format": "png",
        "type": "baselayer",
        "encoding": "terrarium",
        "minzoom": str(ZMIN),
        "maxzoom": str(ZMAX),
        "attribution": (
            "Derived from the NSW 5 m Digital Elevation Model, © State of New"
            f" South Wales (Spatial Services), extracted {extracted}."
            " CC BY 3.0 AU."
        ),
    }
    db.executemany("insert into metadata values (?,?)", metadata.items())
    db.commit()
    db.close()
    subprocess.run(["pmtiles", "convert", str(mbtiles), str(out)], check=True)
    mbtiles.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("fetch")
    p.add_argument("src", type=Path)
    p.add_argument("sheets", nargs="*", help="sheet names, e.g. Katoomba")
    p = sub.add_parser("tile")
    p.add_argument("src", type=Path)
    p.add_argument("work", type=Path)
    p.add_argument("--jobs", type=int, default=os.cpu_count())
    p = sub.add_parser("pack")
    p.add_argument("work", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument(
        "--extracted",
        required=True,
        help='when the sheets were downloaded, e.g. "October 2026"',
    )
    args = parser.parse_args()
    if args.command == "fetch":
        fetch(args.src, args.sheets)
    elif args.command == "tile":
        tile(args.src, args.work, args.jobs)
    else:
        pack(args.work, args.out, args.extracted)


if __name__ == "__main__":
    main()
