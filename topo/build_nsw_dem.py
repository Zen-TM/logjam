#!/usr/bin/env python3
"""
build_nsw_dem.py
----------------
One-off build of the `nsw-5m` DEM archive from the NSW Spatial Services 5 m
DEM sheets: terrarium PNG tiles, 256 px, zoom 8 to 15, heights rounded to a
quarter of a metre, in one PMTiles file.
docs/decisions/0030-dem-tiles-are-terrarium-png-in-pmtiles.md

    build_nsw_dem.py fetch SRC [Sheet ...]     # no sheet named = all 343
    build_nsw_dem.py tile  SRC WORK [--jobs N]
    build_nsw_dem.py pack  WORK OUT.pmtiles --extracted "October 2026"
    build_nsw_dem.py contours SRC WORK OUT.pmtiles --extracted "October 2026"
    build_nsw_dem.py slope IN.pmtiles OUT.pmtiles [--jobs N]
    build_nsw_dem.py contours-archive IN.pmtiles WORK OUT.pmtiles [--interval M]
    build_nsw_dem.py slope-s3 BUCKET [--jobs N]  # the same, from and to the topo bucket

`fetch`, `tile` and `slope` skip what is already done, so a killed run restarts
where it stopped. Run `tile` only once every sheet is fetched: a finished block
is not rebuilt when a neighbouring sheet arrives later. `pack` and `slope` need
the `pmtiles` Python package, and stamp the archive with the month the sheets
were downloaded, which the data's licence asks derived products to
show (docs/decisions/0031-nsw-heights-come-from-the-spatial-services-5m-dem.md).

The work unit is one zoom-10 tile (a "block", about 33 km across here), NOT
one sheet: sheets are in three MGA zones and a tile on a sheet edge needs
both neighbours, so each block is warped from every sheet that touches it.

Heights are averaged down for each coarser zoom BEFORE encoding. Averaging
the encoded RGB instead is wrong: it is not a linear encoding per channel.

`slope` reads the finished height archive and
writes a second archive in the same format whose "height" is the slope of the
ground in degrees, so a client draws it as a raster-dem `color-relief` layer
and the bands stay a style paint expression.

`slope` and `contours-archive` read any ADR 0030 height archive, not only NSW's:
the deepest and coarsest zoom come from its header, the layer name and credit
from its metadata. `fetch`, `tile`, `pack` and `contours` are NSW's own: they
read the Spatial Services sheets.
"""

import argparse
import contextlib
import dataclasses
import io
import json
import math
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from multiprocessing import Pool
from pathlib import Path
from typing import Callable, Dict, Iterator, List, Optional, Tuple

import numpy as np
from osgeo import gdal, osr
from PIL import Image

from regions import region

gdal.UseExceptions()

TILE = 256
ZMAX = 15  # a z15 pixel is ~4 m here: the first zoom finer than the 5 m data
ZMIN = 8
# A block is 2**BLOCK_DEPTH tiles of the deepest zoom along each edge, so its
# grid is at most 8,192 px square whatever that zoom is.
BLOCK_DEPTH = 5


def block_zoom(zmax: int, zmin: int = ZMIN) -> int:
    """The zoom whose tile is one block: z10 for NSW's z15, z12 for a 1 m
    archive's z17. Never coarser than the archive's own coarsest zoom."""
    return max(zmax - BLOCK_DEPTH, zmin)


BLOCK_ZOOM = block_zoom(ZMAX)  # 10
BLOCK_TILES = 2 ** (ZMAX - BLOCK_ZOOM)  # z15 tiles along one NSW block edge
# Finer steps cost bytes and buy nothing: the publisher states +/-0.9 m on
# open ground. At 1/8 m a rugged tile is ~22 % larger.
ROUNDING_M = 0.25
NODATA = -9999.0
# Whole degrees: a band edge cannot be told from the next degree, and the tiles
# are ~half the bytes of 0.25 degree steps (97 MB against 178 MB, Katoomba).
SLOPE_ROUNDING_DEG = 1.0
# The same figure as `EARTH_CIRCUMFERENCE_M` in shared/src/demSlope.ts, so the
# colour and the number at a tap agree: test_nsw_dem.py
# `test_the_earth_is_the_one_demSlope_uses` holds it.
EARTH_CIRCUMFERENCE_M = 40_075_016.686
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


def encode_terrarium(
    heights: np.ndarray, valid: np.ndarray, rounding: float = ROUNDING_M
) -> np.ndarray:
    """Heights (m) to terrarium RGB, rounded to `rounding`.

    A no-data pixel is (0, 0, 0), which decodes to -32768 m: the value
    `demSampleHeight` in shared/src/demTiles.ts reads as "no height here".
    """
    rounded = np.round(heights / rounding) * rounding
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


def halve_max(grid: np.ndarray) -> np.ndarray:
    """The next coarser zoom of a slope grid: the steepest of each 2x2, ignoring
    no-data (NaN).

    The max, not the mean: a cliff is a few pixels wide, and averaged into its
    gentle neighbours it would stop being steep at the zooms a map is read at.
    """
    h, w = grid.shape
    quads = grid.reshape(h // 2, 2, w // 2, 2).swapaxes(1, 2).reshape(h // 2, w // 2, 4)
    return np.fmax.reduce(quads, axis=2).astype(np.float32)


@dataclass(frozen=True)
class Layer:
    """What differs between the height archive and the slope archive."""

    name: str
    derived: str
    reduce: Callable[[np.ndarray], np.ndarray]  # one zoom to the next coarser
    rounding: float
    png_level: int


HEIGHTS = Layer("NSW 5 m DEM", "Derived from", halve, ROUNDING_M, 9)
# Level 6, not 9. Timed on 120 sample Katoomba slope tiles, level 9 takes ~250 ms
# a tile and level 6 ~17 ms; sized on all 2,681 z15 tiles of the sheet, level 6
# is 8 to 12 % bigger. Statewide that is ~70 core-hours of encoding at level 9
# (250 ms x 1.03 M tiles) against ~13 for the whole build at level 6
# (topo/README.md). Heights keep 9 so the published height archive's bytes do
# not change.
SLOPE = Layer(
    "NSW 5 m DEM slope", "Slope derived from", halve_max, SLOPE_ROUNDING_DEG, 6
)


def decode_terrarium(rgb: np.ndarray) -> np.ndarray:
    """The inverse of `encode_terrarium`: float32 values, NaN where no-data."""
    r, g, b = (rgb[..., i].astype(np.float64) for i in range(3))
    value = r * 256 + g + b / 256 - 32768
    return np.where(value <= -32000, np.nan, value).astype(np.float32)


def pixel_size_m(first_row: int, rows: int, zoom: int = ZMAX) -> np.ndarray:
    """Ground size of a pixel on each of `rows` rows from global pixel row
    `first_row`. Web Mercator is conformal, so it is the same both ways."""
    pixels_across = 2**zoom * TILE
    y = (first_row + np.arange(rows) + 0.5) / pixels_across
    lat = np.arctan(np.sinh(np.pi * (1 - 2 * y)))
    return EARTH_CIRCUMFERENCE_M * np.cos(lat) / pixels_across


def horn_slope(window: np.ndarray, cell_m: np.ndarray) -> np.ndarray:
    """Slope in degrees of the inside of a window that has a one-pixel border.

    Horn's method over each pixel's eight neighbours, as `slopeDegrees` in
    shared/src/demSlope.ts: NaN wherever any of the nine heights is NaN. `cell_m`
    is the pixel size on each row of the inside.
    """
    win = window.astype(np.float64)
    nw, n, ne = win[:-2, :-2], win[:-2, 1:-1], win[:-2, 2:]
    w, e = win[1:-1, :-2], win[1:-1, 2:]
    sw, s, se = win[2:, :-2], win[2:, 1:-1], win[2:, 2:]
    cell = cell_m[:, None]
    eastward = ((ne + 2 * e + se) - (nw + 2 * w + sw)) / (8 * cell)
    southward = ((sw + 2 * s + se) - (nw + 2 * n + ne)) / (8 * cell)
    out = np.degrees(np.arctan(np.hypot(eastward, southward)))
    # The centre pixel is not in Horn's sums but is one of the nine.
    return np.where(np.isnan(win[1:-1, 1:-1]), np.nan, out).astype(np.float32)


def credit(layer: Layer, extracted: str) -> str:
    """The attribution the licence asks of a derived product."""
    return (
        f"{layer.derived} the NSW 5 m Digital Elevation Model, © State of New"
        f" South Wales (Spatial Services), extracted {extracted}. CC BY 3.0 AU."
    )


DERIVED = "Derived from "


def derived_credit(product: str, attribution: str) -> str:
    """The credit of a product made from a height archive: `product` is "Slope"
    or "Contours". NSW's own credit starts "Derived from", which becomes
    "Slope derived from"; any other archive's credit follows a colon."""
    if attribution.startswith(DERIVED):
        return f"{product} derived from {attribution[len(DERIVED) :]}"
    return f"{product} derived from: {attribution}"


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


def tile_range(
    bbox: Tuple[float, float, float, float], zoom: int
) -> Tuple[int, int, int, int]:
    """(x0, y0, x1, y1), inclusive, of the tiles covering a box."""
    west, south, east, north = bbox
    x0, y0 = lonlat_to_tile(west, north, zoom)
    x1, y1 = lonlat_to_tile(east, south, zoom)
    return x0, y0, x1, y1


def blocks_for(extent: Tuple[float, float, float, float]) -> Iterator[Tuple[int, int]]:
    """Every block a (west, south, east, north) lon/lat extent touches."""
    west, south, east, north = extent
    x0, y0 = lonlat_to_tile(west, north, BLOCK_ZOOM)
    x1, y1 = lonlat_to_tile(east, south, BLOCK_ZOOM)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            yield x, y


def png_bytes(rgb: np.ndarray, level: int = 9) -> bytes:
    out = io.BytesIO()
    Image.fromarray(rgb).save(out, "PNG", compress_level=level)
    return out.getvalue()


def tiles_of(grid: np.ndarray, z: int, x0: int, y0: int, layer: Layer):
    """(z, x, y, png) for each tile of a square grid that has a value."""
    for row in range(grid.shape[0] // TILE):
        for col in range(grid.shape[1] // TILE):
            h = grid[row * TILE : (row + 1) * TILE, col * TILE : (col + 1) * TILE]
            valid = ~np.isnan(h)
            if valid.any():
                rgb = encode_terrarium(h, valid, layer.rounding)
                yield z, x0 + col, y0 + row, png_bytes(rgb, layer.png_level)


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
        # Not `*.tif`: a killed fetch leaves this behind, and `tile` reads
        # every `*.tif` in the directory as a finished sheet.
        tmp = src / f"{name}.tif.tmp"
        # The .asc carries no CRS: the zone is in the sheet's name only.
        gdal.Translate(
            str(tmp),
            f"/vsizip/{zip_path}/{name}.asc",
            format="GTiff",
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


def save_block(
    grid: np.ndarray,
    bx: int,
    by: int,
    work: Path,
    layer: Layer,
    zmax: int = ZMAX,
    bzoom: int = BLOCK_ZOOM,
) -> int:
    """Encode a block's grid at `zmax` and every zoom down to its tile at
    `bzoom` into the block's file in `work`, renamed into place whole. Returns
    the tile count."""
    tmp = work / f"{bx}-{by}.tmp"
    tmp.unlink(missing_ok=True)
    db = open_block_db(tmp)
    count = 0
    for z in range(zmax, bzoom - 1, -1):
        scale = 2 ** (z - bzoom)
        rows = list(tiles_of(grid, z, bx * scale, by * scale, layer))
        db.executemany("insert into tiles values (?,?,?,?)", rows)
        count += len(rows)
        if z > bzoom:
            grid = layer.reduce(grid)
    db.commit()
    db.close()
    # The block's own tile, for `pack` to reduce into z9 and z8.
    np.save(work / f"{bx}-{by}.npy", grid)
    tmp.rename(work / f"{bx}-{by}.sqlite")
    return count


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

    count = save_block(heights, bx, by, Path(work), HEIGHTS)
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


def coarse_levels(
    level: Dict[Tuple[int, int], np.ndarray],
    zb: int,
    zmin: int,
    layer_at: Callable[[int], Layer],
):
    """(z, x, y, png) for each zoom from zb - 1 down to zmin, each reduced from
    the one below. `level` holds the tiles' grids at zb; `layer_at` gives the
    layer a zoom is reduced and encoded with."""
    for z in range(zb - 1, zmin - 1, -1):
        layer = layer_at(z)
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
            parents[(px, py)] = layer.reduce(quad)
            yield from tiles_of(parents[(px, py)], z, px, py, layer)
        level = parents


def coarse_tiles(work: Path, layer: Layer, bzoom: int = BLOCK_ZOOM, zmin: int = ZMIN):
    """The zooms above the blocks' own (z9 and z8 for NSW), reduced from the
    blocks' own grids."""
    level: Dict[Tuple[int, int], np.ndarray] = {}
    for path in work.glob("*.npy"):
        bx, by = (int(n) for n in path.stem.split("-"))
        level[(bx, by)] = np.load(path)
    yield from coarse_levels(level, bzoom, zmin, lambda z: layer)


def pack(
    work: Path,
    out: Path,
    attribution: str,
    layer: Layer,
    zmax: int = ZMAX,
    zmin: int = ZMIN,
) -> None:
    from pmtiles.convert import mbtiles_to_pmtiles

    out.parent.mkdir(parents=True, exist_ok=True)
    mbtiles = out.with_suffix(".mbtiles")
    mbtiles.unlink(missing_ok=True)
    db = sqlite3.connect(mbtiles)
    db.execute(
        "create table tiles (zoom_level integer, tile_column integer,"
        " tile_row integer, tile_data blob)"
    )
    db.execute("create table metadata (name text, value text)")
    # MBTiles rows are TMS: flipped from the XYZ rows used everywhere else.
    insert = "insert into tiles values (?, ?, ?, ?)"

    def flipped(rows):
        return ((z, x, (1 << z) - 1 - y, data) for z, x, y, data in rows)

    for block in sorted(work.glob("*.sqlite")):
        # Closed by hand: a statewide run has more blocks than a process has
        # file descriptors, and a connection left to the collector holds one.
        with contextlib.closing(sqlite3.connect(block)) as tiles:
            rows = tiles.execute("select z, x, y, data from tiles")
            db.executemany(insert, flipped(rows))
    bzoom = block_zoom(zmax, zmin)
    db.executemany(insert, flipped(coarse_tiles(work, layer, bzoom, zmin)))
    db.execute(
        "create unique index tile_index on tiles (zoom_level, tile_column, tile_row)"
    )
    # Without bounds a reader takes the archive to cover the world, and
    # `pmtiles extract` and MapLibre ask it for tiles it does not have.
    x0, x1, y0, y1 = db.execute(
        "select min(tile_column), max(tile_column), min(tile_row), max(tile_row)"
        " from tiles where zoom_level = ?",
        (zmax,),
    ).fetchone()
    if x0 is None:
        db.close()
        mbtiles.unlink()
        sys.exit(f"no zoom {zmax} tiles in {work}: run `tile` first")
    west, south = tile_lonlat(x0, (1 << zmax) - y0, zmax)
    east, north = tile_lonlat(x1 + 1, (1 << zmax) - 1 - y1, zmax)
    metadata = {
        "bounds": f"{west},{south},{east},{north}",
        "center": f"{(west + east) / 2},{(south + north) / 2},{zmin}",
        "name": layer.name,
        "format": "png",
        "type": "baselayer",
        "encoding": "terrarium",
        "minzoom": str(zmin),
        "maxzoom": str(zmax),
        "attribution": attribution,
    }
    db.executemany("insert into metadata values (?,?)", metadata.items())
    db.commit()
    db.close()
    mbtiles_to_pmtiles(str(mbtiles), str(out), None)
    mbtiles.unlink()


# ── mosaic ───────────────────────────────────────────────────────────────────

SLOPE_NODATA = 255
# Tiles fetched and decoded at once, and how many are handed out together: a
# decoded tile is 256 KB of floats, so at most a chunk of them is ever held.
FETCH_THREADS = 16
FETCH_CHUNK = 256


def write_mosaic(
    reader,
    bbox: Tuple[float, float, float, float],
    path: Path,
    kind: str,
    attribution: str,
    zoom: int = ZMAX,
) -> int:
    """The archive's tiles at `zoom` (z15 statewide, an area's zmax) over the
    box as one tiled web-mercator GeoTIFF:
    heights as Float32 (no-data NODATA), slope as Byte degrees (no-data 255).
    Tiles are fetched and decoded in threads and written by this one, a chunk
    at a time. `reader.get(z, x, y)` is a pmtiles reader or area_export's
    `Archive`. Returns how many tiles the archive had in the box.
    """
    x0, y0, x1, y1 = tile_range(bbox, zoom)
    cols, rows = x1 - x0 + 1, y1 - y0 + 1
    west, _, _, north = tile_bounds_3857(zoom, x0, y0)
    span = tile_bounds_3857(zoom, x0, y0)[2] - west
    heights = kind == "heights"
    dataset = gdal.GetDriverByName("GTiff").Create(
        str(path),
        cols * 256,
        rows * 256,
        1,
        gdal.GDT_Float32 if heights else gdal.GDT_Byte,
        options=[
            "TILED=YES",
            "BLOCKXSIZE=256",
            "BLOCKYSIZE=256",
            "COMPRESS=DEFLATE",
            "PREDICTOR=3" if heights else "PREDICTOR=2",
            "BIGTIFF=IF_SAFER",
            "SPARSE_OK=TRUE",
        ],
    )
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(3857)
    dataset.SetProjection(srs.ExportToWkt())
    dataset.SetGeoTransform((west, span / 256, 0, north, 0, -span / 256))
    # gdalwarp carries a source's metadata to what it writes.
    dataset.SetMetadataItem("TIFFTAG_COPYRIGHT", attribution)
    band = dataset.GetRasterBand(1)
    band.SetNoDataValue(NODATA if heights else SLOPE_NODATA)
    band.Fill(NODATA if heights else SLOPE_NODATA)

    def fetch(xy: Tuple[int, int]):
        x, y = xy
        png = reader.get(zoom, x, y)
        if not png:
            return xy, None
        rgb = np.asarray(Image.open(io.BytesIO(png)).convert("RGB"))
        values = decode_terrarium(rgb)
        if heights:
            return xy, np.where(np.isnan(values), NODATA, values).astype(np.float32)
        return xy, np.where(np.isnan(values), SLOPE_NODATA, values).astype(np.uint8)

    tiles = [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
    found = 0
    with ThreadPoolExecutor(FETCH_THREADS) as pool:
        for start in range(0, len(tiles), FETCH_CHUNK):
            chunk = tiles[start : start + FETCH_CHUNK]
            for (x, y), values in pool.map(fetch, chunk):
                if values is None:
                    continue
                band.WriteArray(values, (x - x0) * 256, (y - y0) * 256)
                found += 1
    band.FlushCache()
    dataset = None
    return found


# ── slope ────────────────────────────────────────────────────────────────────


_heights = None  # this process's reader of the height archive


def open_heights(archive: Path):
    """A reader of the height archive. PMTiles read in place: `pmtiles convert`
    only goes from MBTiles to PMTiles, and the archive is too big to unpack."""
    from pmtiles.reader import MmapSource, Reader

    return Reader(MmapSource(open(archive, "rb")))


def init_worker(archive: Path) -> None:
    global _heights
    _heights = open_heights(archive)


def height_tile(reader, z: int, x: int, y: int) -> Optional[np.ndarray]:
    """A terrarium tile as values, or None where the archive has none."""
    png = reader.get(z, x, y)
    if png is None:
        return None
    return decode_terrarium(np.asarray(Image.open(io.BytesIO(png)).convert("RGB")))


def block_slope(
    get: Callable[[int, int], Optional[np.ndarray]],
    bx: int,
    by: int,
    tiles: int = BLOCK_TILES,
    zoom: int = ZMAX,
) -> np.ndarray:
    """The slope at `zoom` of a block of `tiles` x `tiles` tiles.

    `get(x, y)` is a height tile at `zoom` or None. The ring of neighbouring tiles
    around the block is read too, so Horn is seamless across a block edge as
    well as a tile edge; test_nsw_dem.py `TestBlockSlope` holds the indexing.
    """
    n = tiles + 2
    padded = np.full((n * TILE, n * TILE), np.nan, np.float32)
    present = np.zeros((n, n), bool)
    for row in range(n):
        for col in range(n):
            height = get(bx * tiles - 1 + col, by * tiles - 1 + row)
            if height is not None:
                present[row, col] = True
                padded[row * TILE : (row + 1) * TILE, col * TILE : (col + 1) * TILE] = (
                    height
                )
    size = tiles * TILE
    slope = np.empty((size, size), np.float32)
    for row in range(tiles):
        top = (row + 1) * TILE
        # A strip with no height tile in it or beside it (sea, off the archive)
        # would spend ~0.5 s of float64 Horn on NaN; coastal and border blocks
        # are mostly such strips.
        if not present[row : row + 3].any():
            slope[row * TILE : (row + 1) * TILE] = np.nan
            continue
        slope[row * TILE : (row + 1) * TILE] = horn_slope(
            padded[top - 1 : top + TILE + 1, TILE - 1 : TILE + size + 1],
            pixel_size_m((by * tiles + row) * TILE, TILE, zoom),
        )
    return slope


def slope_block(job: Tuple[int, int, str, int, int]) -> Optional[str]:
    bx, by, work, zmax, zmin = job
    if (Path(work) / f"{bx}-{by}.sqlite").exists():
        return None
    bzoom = block_zoom(zmax, zmin)
    slope = block_slope(
        lambda x, y: height_tile(_heights, zmax, x, y),
        bx,
        by,
        2 ** (zmax - bzoom),
        zmax,
    )
    count = save_block(slope, bx, by, Path(work), SLOPE, zmax, bzoom)
    return f"{bx}/{by}: {count} tiles"


def archive_blocks(reader) -> Tuple[int, int, int, List[Tuple[int, int]]]:
    """(deepest zoom, coarsest zoom, block zoom, blocks) of a height archive:
    the zooms from its header, and the blocks over its bounds that have a tile.
    `build_slope` and `contours_archive` both build exactly these blocks. A
    block's tile exists exactly where one of its deepest tiles has a height
    (test_nsw_dem.py `TestArchiveBlocks`)."""
    header = reader.header()
    zmax, zmin = header["max_zoom"], header["min_zoom"]
    bzoom = block_zoom(zmax, zmin)
    x0, y0, x1, y1 = tile_range(
        (
            header["min_lon_e7"] / 1e7,
            header["min_lat_e7"] / 1e7,
            header["max_lon_e7"] / 1e7,
            header["max_lat_e7"] / 1e7,
        ),
        bzoom,
    )
    blocks = [
        (bx, by)
        for bx in range(x0, x1 + 1)
        for by in range(y0, y1 + 1)
        if reader.get(bzoom, bx, by) is not None
    ]
    return zmax, zmin, bzoom, blocks


def build_slope(heights: Path, out: Path, work: Path, jobs: int) -> None:
    """The slope archive of a height archive: see the module docstring.

    Any height archive will do. Its deepest and coarsest zoom come from its
    header, and its layer name and credit from its metadata. A block is every
    tile of the deepest zoom under one tile of `block_zoom`, as in `tile`, and
    the same resume rule holds: a block file already in `work` is kept, whatever made it,
    so a killed run restarts where it stopped. The default `work` is the slope
    archive's own.

    A child killed part-way (out of memory) raises `BrokenProcessPool` here
    instead of leaving the run waiting for a block that will never come. That
    is why this uses `ProcessPoolExecutor`: `multiprocessing.Pool`, as `tile`
    does, waits forever in the same case.
    """
    work.mkdir(parents=True, exist_ok=True)
    reader = open_heights(heights)
    # The slope archive says what the heights it came from say, not a name or
    # month typed again by hand (test_nsw_dem.py `TestBuildSlopeCredit`).
    metadata = reader.metadata()
    layer = dataclasses.replace(SLOPE, name=f"{metadata.get('name', 'DEM')} slope")
    attribution = derived_credit("Slope", metadata["attribution"])
    zmax, zmin, _, blocks = archive_blocks(reader)
    todo = [(bx, by, str(work), zmax, zmin) for bx, by in blocks]
    print(f"{len(todo)} blocks", flush=True)
    with ProcessPoolExecutor(
        jobs, initializer=init_worker, initargs=(heights,)
    ) as pool:
        futures = [pool.submit(slope_block, job) for job in todo]
        try:
            for n, done in enumerate(as_completed(futures), 1):
                if line := done.result():
                    print(f"[{n}/{len(todo)}] {line}", flush=True)
        except BaseException:
            # Cancels what is queued and waits only for the blocks already
            # running. `wait=False` here would be undone by the `with`'s own
            # shutdown, which runs every queued block before the process exits
            # (test_nsw_dem.py `TestBuildSlope`).
            pool.shutdown(cancel_futures=True)
            raise
    pack(work, out, attribution, layer, zmax, zmin)


# NSW's archives, as regions.json names them (test_nsw_dem.py
# `test_the_keys_are_the_archives_regions_json_declares_for_nsw` holds these
# reading it, not a path written here).
_NSW_TERRAIN = region("nsw")["terrain"]
HEIGHT_KEY = _NSW_TERRAIN["heights"]["archivePath"]
SLOPE_KEY = _NSW_TERRAIN["slope"]["archivePath"]
CONTOUR_KEY = _NSW_TERRAIN["contours"]["archivePath"]


def slope_s3(bucket: str, work: Path, jobs: int, client=None) -> None:
    """`slope` on the published height archive, publishing the result.

    What the Fargate task runs (topo/README.md, "Building it in AWS"). Every
    step raises on failure, so the task exits non-zero and nothing is uploaded
    from a build that did not finish (test_nsw_dem.py `TestSlopeS3`).
    """
    if client is None:
        import boto3

        client = boto3.client("s3")
    work.mkdir(parents=True, exist_ok=True)
    heights, out = work / "nsw-5m.pmtiles", work / "nsw-5m-slope.pmtiles"
    print(f"downloading s3://{bucket}/{HEIGHT_KEY}", flush=True)
    client.download_file(bucket, HEIGHT_KEY, str(heights))
    print(f"downloaded {heights.stat().st_size:,} bytes", flush=True)
    build_slope(heights, out, work / "blocks", jobs)
    print(f"built {out.stat().st_size:,} bytes", flush=True)
    client.upload_file(
        str(out),
        bucket,
        SLOPE_KEY,
        ExtraArgs={"ContentType": "application/vnd.pmtiles"},
    )
    print(f"uploaded s3://{bucket}/{SLOPE_KEY}", flush=True)


# ── contours ─────────────────────────────────────────────────────────────────

CONTOUR_INTERVAL_M = 10
# The cell heights are averaged to before contouring (see `contours`).
CONTOUR_CELL_M = 10
CONTOUR_MAJOR_M = 50  # the clients style `elev % 50 == 0` as a major line
# 50 m lines from z11 and the rest from z14, the zooms both clients draw them
# at (the pattern a topo area's own contours have); a client overzooms past z14.
CONTOUR_ZOOMS = {"major": (11, 14), "minor": (14, 14)}
# The source layer both clients read: `sourceLayer: "contours"` (Logjam GPS)
# and `"source-layer": "contours"` (Logjam Web).
CONTOUR_LAYER = "contours"


def run(*command: str) -> None:
    subprocess.run(command, check=True)


def contour_lines(
    raster: Path,
    raw: Path,
    lines: Path,
    run=run,
    interval: int = CONTOUR_INTERVAL_M,
    clip: Optional[Tuple[float, float, float, float]] = None,
) -> None:
    """Lines of a height raster every `interval` metres into a GeoPackage in
    lon/lat, as two layers: `major` (every CONTOUR_MAJOR_M) and `minor`, cut to
    the lon/lat box `clip` (west, south, east, north) when given. A whole number
    of metres, so every line sits on a whole metre and the `cast(elev as
    integer)` below is exact. The statewide archive, any other region's and a
    sharpened area's (sharpen.py) are all cut by this, so they share a schema."""
    cut = ["-clipdst", *map(str, clip)] if clip else []
    run(
        *["gdal_contour", "-q", "-a", "elev", "-i", str(interval)],
        *["-snodata", str(NODATA), "-f", "GPKG", str(raster), str(raw)],
        *["-nln", "cont"],
    )
    for name, test in (("major", "="), ("minor", "<>")):
        run(
            *["ogr2ogr", "-q", "-f", "GPKG", "-update", "-append", str(lines)],
            *[str(raw), "-t_srs", "EPSG:4326", "-nln", name, *cut, "-sql"],
            "select elev, geom from cont where cast(elev as integer)"
            f" % {CONTOUR_MAJOR_M} {test} 0",
        )


def need_pmtiles(command: str) -> None:
    if not shutil.which("pmtiles"):
        sys.exit(f"{command} needs the `pmtiles` binary (go-pmtiles) on PATH")


def pack_contours(work: Path, out: Path, description: str) -> None:
    """Every `*.lines.gpkg` in `work` as vector tiles in one PMTiles archive."""
    # Every file's two layers as one, without copying them: an OGR virtual
    # dataset that reads the files in place.
    sheets = sorted(work.glob("*.lines.gpkg"))
    union = work / "contours.vrt"
    union.write_text(
        "<OGRVRTDataSource>"
        + "".join(
            f'<OGRVRTUnionLayer name="{name}">'
            + "".join(
                f'<OGRVRTLayer name="{name}"><SrcDataSource>{sheet.resolve()}'
                f"</SrcDataSource><SrcLayer>{name}</SrcLayer></OGRVRTLayer>"
                for sheet in sheets
            )
            + "</OGRVRTUnionLayer>"
            for name in CONTOUR_ZOOMS
        )
        + "</OGRVRTDataSource>"
    )

    mbtiles = out.with_suffix(".mbtiles")
    mbtiles.unlink(missing_ok=True)
    conf = {
        name: {"target_name": CONTOUR_LAYER, "minzoom": zmin, "maxzoom": zmax}
        for name, (zmin, zmax) in CONTOUR_ZOOMS.items()
    }
    zmin = min(z for z, _ in CONTOUR_ZOOMS.values())
    zmax = max(z for _, z in CONTOUR_ZOOMS.values())
    run(
        *["ogr2ogr", "-q", "-f", "MVT", str(mbtiles), str(union)],
        *["-dsco", "FORMAT=MBTILES"],
        *["-dsco", f"MINZOOM={zmin}", "-dsco", f"MAXZOOM={zmax}"],
        *["-dsco", f"CONF={json.dumps(conf)}"],
        "-dsco",
        f"DESCRIPTION={description}",
    )
    run("pmtiles", "convert", str(mbtiles), str(out))
    mbtiles.unlink()


def contours(src: Path, work: Path, out: Path, extracted: str) -> None:
    """10 m contours of every sheet, as vector tiles in one PMTiles archive.

    One source layer, `contours`, with one attribute, `elev`: the schema of a
    LiDAR job's contour layer (`pipeline.py`), so both clients draw it with
    the layer definitions they already have.

    ponytail: each sheet is contoured alone, so a line ends at a sheet edge and
    its continuation starts beside it. Contour a buffered mosaic per sheet if
    the joins show.
    """
    need_pmtiles("contours")
    work.mkdir(parents=True, exist_ok=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    for sheet in sorted(src.glob("*.tif")):
        # One file per sheet, renamed into place when whole: a run killed
        # part-way redoes that sheet instead of adding its lines twice.
        lines = work / f"{sheet.stem}.lines.gpkg"
        if lines.exists():
            continue
        print(sheet.stem, flush=True)
        smooth = work / f"{sheet.stem}.10m.tif"
        raw = work / f"{sheet.stem}.raw.gpkg"
        part = work / f"{sheet.stem}.part.gpkg"
        raw.unlink(missing_ok=True)
        part.unlink(missing_ok=True)
        # Averaged to 10 m first: contours of the raw 5 m grid are knobbly,
        # and every wiggle is a vertex a phone has to store and draw.
        cell = str(CONTOUR_CELL_M)
        run(
            *["gdalwarp", "-q", "-overwrite", "-tr", cell, cell, "-r", "average"],
            *["-co", "COMPRESS=ZSTD", str(sheet), str(smooth)],
        )
        contour_lines(smooth, raw, part)
        smooth.unlink()
        raw.unlink()
        part.rename(lines)

    pack_contours(
        work,
        out,
        derived_credit("Contours", credit(HEIGHTS, extracted)),
    )


def smoothing_factor(ground_px_m: float) -> int:
    """How many deepest-zoom pixels along an edge average to one contouring cell:
    the power of two whose cell is nearest CONTOUR_CELL_M of ground as a ratio
    (the rounding is in the logarithm), and never finer than the data. A power of two divides a tile's 256 px, so a cell
    never straddles a tile edge (test_nsw_dem.py `TestContourSmoothing`)."""
    return min(256, 2 ** max(0, round(math.log2(CONTOUR_CELL_M / ground_px_m))))


def archive_smoothing(header: dict, zmax: int) -> int:
    """`smoothing_factor` at the latitude of the archive's centre: one factor for
    every block, so neighbouring blocks average on one grid wherever the factor
    would change with latitude (test_nsw_dem.py `TestContoursArchive`)."""
    lat = (header["min_lat_e7"] + header["max_lat_e7"]) / 2e7
    row = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2**zmax * TILE
    return smoothing_factor(float(pixel_size_m(int(row), 1, zmax)[0]))


def centre_box(
    x0: int, y0: int, x1: int, y1: int, z: int
) -> Tuple[float, float, float, float]:
    """A lon/lat box that `tile_range` reads back as exactly tiles x0..x1, y0..y1:
    the hull of the first and last tile's centres."""
    west, north = tile_lonlat(x0 + 0.5, y0 + 0.5, z)
    east, south = tile_lonlat(x1 + 0.5, y1 + 0.5, z)
    return west, south, east, north


def contours_archive(
    heights: Path, work: Path, out: Path, interval: int = CONTOUR_INTERVAL_M
) -> None:
    """Contours of a height archive, as vector tiles in one PMTiles archive: the
    schema `contours` makes, so both clients draw it unchanged. See `contours`
    for the layer and the major lines.

    A block is the same square of tiles as in `build_slope`. Its deepest tiles
    are mosaicked with one extra tile around, averaged on a grid every block
    shares (`archive_smoothing`), contoured, and clipped to the block, so the
    lines of two blocks line up at their edge with none doubled. A block file
    already in `work` is kept, as in `build_slope`, whatever interval or archive
    made it: a changed `interval` or a different archive needs a fresh `work`.
    """
    need_pmtiles("contours-archive")
    work.mkdir(parents=True, exist_ok=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    reader = open_heights(heights)
    metadata = reader.metadata()
    header = reader.header()
    zmax, _, bzoom, todo = archive_blocks(reader)
    tiles = 2 ** (zmax - bzoom)
    print(f"{len(todo)} blocks", flush=True)
    cell = str(archive_smoothing(header, zmax) * 2 * HALF_WORLD_M / (2**zmax * TILE))
    for n, (bx, by) in enumerate(todo, 1):
        lines = work / f"{bx}-{by}.lines.gpkg"
        if lines.exists():
            continue
        tag = work / f"{bx}-{by}"
        mosaic = Path(f"{tag}.mosaic.tif")
        smooth = Path(f"{tag}.smooth.tif")
        raw = Path(f"{tag}.raw.gpkg")
        part = Path(f"{tag}.part.gpkg")
        raw.unlink(missing_ok=True)
        part.unlink(missing_ok=True)
        # One tile of margin, so a line is not cut short at the block's edge.
        last = 2**zmax - 1
        mx0, my0 = max(bx * tiles - 1, 0), max(by * tiles - 1, 0)
        mx1, my1 = min((bx + 1) * tiles, last), min((by + 1) * tiles, last)
        write_mosaic(
            reader,
            centre_box(mx0, my0, mx1, my1, zmax),
            mosaic,
            "heights",
            metadata["attribution"],
            zmax,
        )
        west, _, _, north = tile_bounds_3857(zmax, mx0, my0)
        _, _, east, _ = tile_bounds_3857(zmax, mx1, my1)
        _, south, _, _ = tile_bounds_3857(zmax, mx0, my1)
        run(
            *["gdalwarp", "-q", "-overwrite", "-tr", cell, cell, "-r", "average"],
            *["-te", *map(str, (west, south, east, north))],
            *["-srcnodata", str(NODATA), "-dstnodata", str(NODATA)],
            *["-co", "COMPRESS=ZSTD", str(mosaic), str(smooth)],
        )
        w, nw_lat = tile_lonlat(bx, by, bzoom)
        e, s_lat = tile_lonlat(bx + 1, by + 1, bzoom)
        print(f"[{n}/{len(todo)}]", flush=True)
        contour_lines(smooth, raw, part, interval=interval, clip=(w, s_lat, e, nw_lat))
        for done in (mosaic, smooth, raw):
            done.unlink(missing_ok=True)
        part.rename(lines)
    pack_contours(
        work,
        out,
        derived_credit("Contours", metadata["attribution"]),
    )


def positive_int(text: str) -> int:
    """An `--interval`: a whole number of metres, so `contour_lines` can pick
    the major lines by `cast(elev as integer)` (test_nsw_dem.py
    `TestPositiveInt`)."""
    if not (text.isascii() and text.isdigit()) or int(text) < 1:
        raise argparse.ArgumentTypeError(f"{text!r} is not a whole number of metres")
    return int(text)


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
    p = sub.add_parser("contours")
    p.add_argument("src", type=Path)
    p.add_argument("work", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument("--extracted", required=True, help="as for pack")
    p = sub.add_parser("contours-archive")
    p.add_argument("heights", type=Path, help="a height archive, e.g. nsw-5m.pmtiles")
    p.add_argument("work", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument(
        "--interval",
        type=positive_int,
        default=CONTOUR_INTERVAL_M,
        help="whole metres between lines (default %(default)s); a line on a multiple of 50 m is major, so an interval that does not divide 50 gives fewer major lines",
    )
    p = sub.add_parser("slope")
    p.add_argument("heights", type=Path, help="a height archive, e.g. nsw-5m.pmtiles")
    p.add_argument("out", type=Path)
    p.add_argument(
        "--work", type=Path, help="default: OUT with .work in place of .pmtiles"
    )
    p.add_argument("--jobs", type=int, default=os.cpu_count())
    p = sub.add_parser("slope-s3")
    p.add_argument("bucket", help="the topo bucket")
    p.add_argument(
        "--work", type=Path, default=Path(tempfile.gettempdir()) / "nsw-slope"
    )
    p.add_argument("--jobs", type=int, default=os.cpu_count())
    args = parser.parse_args()
    if args.command == "fetch":
        fetch(args.src, args.sheets)
    elif args.command == "contours":
        contours(args.src, args.work, args.out, args.extracted)
    elif args.command == "contours-archive":
        contours_archive(args.heights, args.work, args.out, args.interval)
    elif args.command == "slope":
        work = args.work or args.out.with_suffix(".work")
        build_slope(args.heights, args.out, work, args.jobs)
    elif args.command == "slope-s3":
        slope_s3(args.bucket, args.work, args.jobs)
    elif args.command == "tile":
        tile(args.src, args.work, args.jobs)
    else:
        pack(args.work, args.out, credit(HEIGHTS, args.extracted), HEIGHTS)


if __name__ == "__main__":
    main()
