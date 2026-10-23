#!/usr/bin/env python3
"""
sharpen.py
----------
Sharpen an area: an ELVIS ZIP to the statewide terrain formats at the
survey's own cell, for a job the API marked to sharpen (`topo_jobs.sharpen`).

    sharpen.py ZIP OUT --statewide-heights SRC --statewide-slope SRC
                       [--workers N] [--progress-file P] [--metrics-json P]

SRC is a local `.pmtiles` path or `s3://bucket/key`: the published
`nsw-5m.pmtiles` and `nsw-5m-slope.pmtiles`. OUT receives:

  heights.pmtiles   terrarium heights, z15 to zmax, a mean pyramid (ADR 0030)
  slope.pmtiles     terrarium slope in degrees, z15 to zmax, a max pyramid (ADR 0039)
  contours.pmtiles  10 m contours at z14, the statewide archive's schema
  footprint.geojson where the survey has ground
  sharpen.json      zmax, the tile range, coverage, ground kind, extraction month

A ZIP Logjam cannot sharpen (no ground classified, only 5 m DEMs) writes
`error.json` with the sentence its owner reads and exits 2.

Each archive holds every tile of one range: the z15 tiles over the
footprint's bbox, widened to whole z14 tiles, and all their descendants to
zmax (z14 for contours). Where the survey has no ground, a tile holds the
statewide 5 m data instead, so a client can take each tile from exactly one
archive and draw no seam.

Ground is the ZIP's ELVIS DEM when it has one; otherwise the survey's own
class 2, as a TIN. Never a re-classification of the points: on a classified
survey that puts ground on the canopy.

PRIVACY: the footprint, the tile range and every tile index say where the
user surveyed. Nothing here logs them; counts and timings only.
"""

import argparse
import contextlib
import dataclasses
import functools
import json
import logging
import math
import os
import sqlite3
import subprocess
import sys
import tempfile
import zipfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Callable, List, Optional, Tuple

import numpy as np

import build_nsw_dem as dem
import pipeline

log = logging.getLogger("sharpen")

# The first zoom finer than the statewide 5 m data: the archives start here,
# and the statewide layer draws every zoom above.
ZMIN = 15
CONTOUR_ZOOM = 14
# Pixel ground size at -34° is ~1.0 m at z17 and ~2.0 m at z16.
DENSE_GROUND_PTS_M2 = 1.0  # class 2 per m² that supports a 1 m cell (lab, Q1)
# Neighbouring tiles' ground read around a tile, so its TIN meets theirs.
TIN_BUFFER_M = 30
# A triangle longer than this spans a void (water, a gap in the survey), not
# ground: the cells under it take the statewide value instead.
TIN_MAX_EDGE_M = 50
# Pixels of context around a block: Horn needs one, the contour smoothing a
# few more at the contour grid.
MARGIN_PX = 16
CONTOUR_SMOOTH_SIGMA_M = 3.0
NODATA = dem.NODATA

# Heights are rounded finer at each zoom past z15: ADR 0030's quarter metre
# was sized for z15's ~4 m pixels, and on 1 m pixels the same step draws
# terraces in the hillshade and puts up to ~7° of noise in a tapped slope.
# Halving it with the pixel keeps z15's noise (tests/test_sharpen.py
# `TestPyramid`).
HEIGHTS = dem.Layer("Sharpened heights", "", dem.halve, dem.ROUNDING_M, 9)
SLOPE = dem.Layer("Sharpened slope", "", dem.halve_max, dem.SLOPE_ROUNDING_DEG, 6)

NO_GROUND = (
    "This ZIP's point clouds have no ground marked in them. Add the DEM ELVIS "
    "offers for the same area to the ZIP, and make it again."
)
ONLY_5M = (
    "This ZIP holds only 5 m DEMs, which Logjam already has for all of NSW. "
    "Choose the 1 m or 2 m DEM, or the point clouds, in ELVIS."
)


class CannotSharpen(Exception):
    """A ZIP Logjam cannot sharpen; the message is its owner's sentence."""


# ── Pure pieces (tests/test_sharpen.py) ──────────────────────────────────────


def zoom_for_cell(cell_m: float) -> Optional[int]:
    """The deepest zoom a ground grid of this cell supports, or None when it
    is no finer than the statewide 5 m data."""
    if cell_m <= 1.5:
        return 17
    if cell_m <= 3.0:
        return 16
    return None


def cell_for_density(ground_per_m2: float) -> int:
    """1 m where the survey's class 2 holds a point a metre, else 2 m."""
    return 1 if ground_per_m2 >= DENSE_GROUND_PTS_M2 else 2


def tile_range(
    bbox: Tuple[float, float, float, float],
) -> Tuple[int, int, int, int]:
    """The z15 tiles over a (west, south, east, north) bbox, widened to whole
    z14 tiles: inclusive [x0, y0, x1, y1], x0 and y0 even, x1 and y1 odd."""
    west, south, east, north = bbox
    x0, y0 = dem.lonlat_to_tile(west, north, ZMIN)
    x1, y1 = dem.lonlat_to_tile(east, south, ZMIN)
    return x0 & ~1, y0 & ~1, x1 | 1, y1 | 1


def blocks_of(tiles15: Tuple[int, int, int, int]) -> List[Tuple[int, int]]:
    """The z14 tiles of a range: the unit of work."""
    x0, y0, x1, y1 = tiles15
    return [
        (bx, by)
        for by in range(y0 >> 1, (y1 >> 1) + 1)
        for bx in range(x0 >> 1, (x1 >> 1) + 1)
    ]


def fill(ground: np.ndarray, statewide: np.ndarray) -> np.ndarray:
    """The survey's value wherever it has one, the statewide one elsewhere."""
    return np.where(np.isnan(ground), statewide, ground).astype(np.float32)


def block_grids(
    ground: np.ndarray,
    statewide_heights: np.ndarray,
    statewide_slope: np.ndarray,
    first_row: int,
    zoom: int,
    margin: int = MARGIN_PX,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """A block's heights and slope at `zoom`, and its filled heights with the
    margin kept (for contours).

    Every grid but the slope comes with `margin` pixels on each side;
    `first_row` is the global pixel row of the first pixel inside the margin.
    Slope is Horn over the survey's ground alone, then filled: Horn over the
    filled heights would read the step where the two surfaces meet as a false
    slope (tests/test_sharpen.py `TestBlockGrids`).
    """
    filled = fill(ground, statewide_heights)
    inner = slice(margin, -margin)
    ring = slice(margin - 1, -(margin - 1))
    rows = ground.shape[0] - 2 * margin
    slope = dem.horn_slope(ground[ring, ring], dem.pixel_size_m(first_row, rows, zoom))
    slope = fill(slope, statewide_slope[inner, inner])
    return filled[inner, inner], slope, filled


def rounding_at(layer: dem.Layer, z: int) -> dem.Layer:
    """Heights rounded to ADR 0030's step at z15, halved each zoom deeper."""
    if layer is not HEIGHTS:
        return layer
    return dataclasses.replace(layer, rounding=layer.rounding / 2 ** (z - ZMIN))


def pyramid(grid: np.ndarray, zmax: int, bx: int, by: int, layer: dem.Layer):
    """(z, x, y, png) for each tile of a z14 block's grid at zmax, then each
    coarser zoom down to ZMIN."""
    for z in range(zmax, ZMIN - 1, -1):
        scale = 2 ** (z - CONTOUR_ZOOM)
        yield from dem.tiles_of(grid, z, bx * scale, by * scale, rounding_at(layer, z))
        if z > ZMIN:
            grid = layer.reduce(grid)


def extraction_month(zip_path: str) -> str:
    """The month ELVIS packed the ZIP, from its newest entry: the date the
    licence asks a derived product to show."""
    with zipfile.ZipFile(zip_path) as zf:
        newest = max(info.date_time for info in zf.infolist())
    return datetime(*newest).strftime("%B %Y")


def credit(extracted: str) -> str:
    """What ELVIS metadata asks of a derived product (CC BY 3.0 AU)."""
    return (
        "Elevation: derived from a LiDAR survey, © Department of Customer"
        f" Service (NSW Spatial Services), extracted {extracted}. CC BY 3.0 AU."
    )


# ── Ground ───────────────────────────────────────────────────────────────────


def run(*command: str) -> str:
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout


def las_summary(path: str) -> dict:
    """Point count and XY bounds from the header, without reading the points."""
    return json.loads(run("pdal", "info", "--summary", path))["summary"]


def dem_ground(dem_files: List[Path], out: str) -> int:
    """Mosaic the ZIP's DEMs; returns zmax."""
    cells = []
    for path in dem_files:
        ds = pipeline.gdal.Open(str(path))
        cells.append(abs(ds.GetGeoTransform()[1]))
        ds = None
    zmax = zoom_for_cell(min(cells))
    if zmax is None:
        raise CannotSharpen(ONLY_5M)
    pipeline.merge_dem_tiles(dem_files, out)
    return zmax


def _tin_tile(job: Tuple[str, dict, List[str], float, str, str]) -> str:
    """One tile's TIN of class 2 from its own and its neighbours' ground."""
    name, bounds, neighbours, cell, out, work = job
    b = TIN_BUFFER_M
    ox = math.floor(bounds["minx"] / cell) * cell
    oy = math.floor(bounds["miny"] / cell) * cell
    width = math.ceil((bounds["maxx"] - ox) / cell)
    height = math.ceil((bounds["maxy"] - oy) / cell)
    stages: list = [{"type": "readers.las", "filename": n} for n in neighbours]
    stages += [
        {"type": "filters.merge"},
        {
            "type": "filters.crop",
            "bounds": f"([{bounds['minx'] - b},{bounds['maxx'] + b}],"
            f"[{bounds['miny'] - b},{bounds['maxy'] + b}])",
        },
        {"type": "filters.delaunay"},
        {
            "type": "filters.faceraster",
            "resolution": cell,
            "origin_x": ox,
            "origin_y": oy,
            "width": width,
            "height": height,
            "max_triangle_edge_length": TIN_MAX_EDGE_M,
        },
        {
            "type": "writers.raster",
            "filename": out,
            "data_type": "float32",
            "nodata": NODATA,
        },
    ]
    pipeline.run_pdal_pipeline({"pipeline": stages}, work, f"tin-{name}")
    return out


def laz_ground(las_files: List[Path], out: str, work: Path, workers: int) -> int:
    """A TIN of the survey's class 2 over every terrain tile; returns zmax."""
    terrain = pipeline.select_surveys_by_layer([str(f) for f in las_files])
    tiles = terrain.terrain_tiles
    grounds, bounds, area = [], [], 0.0
    total = 0
    for i, path in enumerate(tiles):
        b = las_summary(path)["bounds"]
        area += (b["maxx"] - b["minx"]) * (b["maxy"] - b["miny"])
        ground = str(work / f"ground-{i}.las")
        run(
            *["pdal", "translate", path, ground, "range"],
            "--filters.range.limits=Classification[2:2]",
        )
        total += int(las_summary(ground)["num_points"])
        grounds.append(ground)
        bounds.append(b)
        pipeline._write_progress(i + 1, len(tiles), "ground")
    if total == 0:
        raise CannotSharpen(NO_GROUND)
    density = total / area
    cell = cell_for_density(density)
    log.info(f"{len(tiles)} tile(s), {density:.2f} ground pts/m² → {cell} m cell")

    def near(a: dict, c: dict) -> bool:
        return not (
            c["minx"] > a["maxx"] + TIN_BUFFER_M
            or c["maxx"] < a["minx"] - TIN_BUFFER_M
            or c["miny"] > a["maxy"] + TIN_BUFFER_M
            or c["maxy"] < a["miny"] - TIN_BUFFER_M
        )

    jobs = [
        (
            str(i),
            b,
            [g for g, c in zip(grounds, bounds) if near(b, c)],
            float(cell),
            str(work / f"tin-{i}.tif"),
            str(work),
        )
        for i, b in enumerate(bounds)
    ]
    with ProcessPoolExecutor(workers) as pool:
        tins = [Path(f.result()) for f in [pool.submit(_tin_tile, j) for j in jobs]]
    pipeline.merge_dem_tiles(tins, out)
    return zoom_for_cell(cell)


# ── Statewide tiles ──────────────────────────────────────────────────────────


def open_archive(src: str):
    """A reader of a local archive, or of one in S3 by byte range. Ranges are
    cached: the reader asks for the header and directories on every tile."""
    from pmtiles.reader import MmapSource, Reader

    if not src.startswith("s3://"):
        return Reader(MmapSource(open(src, "rb")))
    import boto3

    bucket, _, key = src[len("s3://") :].partition("/")
    client = boto3.client(
        "s3", region_name=os.environ.get("AWS_REGION", "ap-southeast-2")
    )

    @functools.lru_cache(maxsize=1024)
    def get_bytes(offset: int, length: int) -> bytes:
        rng = f"bytes={offset}-{offset + length - 1}"
        return client.get_object(Bucket=bucket, Key=key, Range=rng)["Body"].read()

    return Reader(get_bytes)


def z15_mosaic(get: Callable[[int, int], Optional[np.ndarray]], bx: int, by: int):
    """The z15 tiles of a z14 block and the ring around it, as one grid."""
    n = 4
    grid = np.full((n * dem.TILE, n * dem.TILE), np.nan, np.float32)
    for row in range(n):
        for col in range(n):
            tile = get(2 * bx - 1 + col, 2 * by - 1 + row)
            if tile is not None:
                t = dem.TILE
                grid[row * t : (row + 1) * t, col * t : (col + 1) * t] = tile
    return grid


# ── One block ────────────────────────────────────────────────────────────────

_ctx: dict = {}


def init_block_worker(heights: str, slope: str, ground: str, zmax: int, work: str):
    _ctx.update(
        heights=open_archive(heights),
        slope=open_archive(slope),
        ground=ground,
        zmax=zmax,
        work=Path(work),
    )


def _warp(src, bounds, size: int, alg: str) -> np.ndarray:
    gdal = pipeline.gdal
    ds = gdal.Warp(
        "",
        src,
        format="MEM",
        dstSRS="EPSG:3857",
        outputBounds=bounds,
        width=size,
        height=size,
        resampleAlg=alg,
        outputType=gdal.GDT_Float32,
        srcNodata=NODATA,
        dstNodata=NODATA,
    )
    out = ds.GetRasterBand(1).ReadAsArray().astype(np.float32)
    out[out <= NODATA + 1] = np.nan
    return out


def mercator_wkt() -> str:
    srs = pipeline.osr.SpatialReference()
    srs.ImportFromEPSG(3857)
    return srs.ExportToWkt()


def _mem(grid: np.ndarray, bounds):
    """A grid in web mercator as a GDAL dataset, NaN as NODATA."""
    gdal = pipeline.gdal
    ds = gdal.GetDriverByName("MEM").Create(
        "", grid.shape[1], grid.shape[0], 1, gdal.GDT_Float32
    )
    west, south, east, north = bounds
    ds.SetGeoTransform(
        (
            west,
            (east - west) / grid.shape[1],
            0,
            north,
            0,
            -(north - south) / grid.shape[0],
        )
    )
    ds.SetProjection(mercator_wkt())
    band = ds.GetRasterBand(1)
    band.SetNoDataValue(NODATA)
    band.WriteArray(np.where(np.isnan(grid), NODATA, grid))
    return ds


def statewide_tile(reader, x: int, y: int) -> Optional[np.ndarray]:
    return dem.height_tile(reader, ZMIN, x, y)


def sharpen_block(block: Tuple[int, int]) -> int:
    """Heights and slope tiles of one z14 block into its own file, and its
    filled heights at the contour grid. Returns the tile count."""
    bx, by = block
    zmax, work = _ctx["zmax"], _ctx["work"]
    size = 2 * dem.TILE * 2 ** (zmax - ZMIN)
    m = MARGIN_PX
    west, south, east, north = dem.tile_bounds_3857(CONTOUR_ZOOM, bx, by)
    px = (east - west) / size
    outer = (west - m * px, south - m * px, east + m * px, north + m * px)

    ground = _warp(_ctx["ground"], outer, size + 2 * m, "bilinear")
    # The z15 mosaic reaches one z15 tile (half the block) past each edge.
    span = east - west
    ring = (west - span / 2, south - span / 2, east + span / 2, north + span / 2)
    up = {}
    for name in ("heights", "slope"):
        mosaic = z15_mosaic(lambda x, y: statewide_tile(_ctx[name], x, y), bx, by)
        up[name] = _warp(_mem(mosaic, ring), outer, size + 2 * m, "bilinear")

    first_row = by * size
    heights, slope, filled = block_grids(
        ground, up["heights"], up["slope"], first_row, zmax
    )

    tmp = work / f"{bx}-{by}.tmp"
    tmp.unlink(missing_ok=True)
    count = 0
    with contextlib.closing(sqlite3.connect(tmp)) as db:
        db.execute(
            "create table tiles (layer text, z integer, x integer, y integer, data blob)"
        )
        for name, grid, layer in (
            ("heights", heights, HEIGHTS),
            ("slope", slope, SLOPE),
        ):
            rows = [(name, *t) for t in pyramid(grid, zmax, bx, by, layer)]
            db.executemany("insert into tiles values (?,?,?,?,?)", rows)
            count += len(rows)
        db.commit()
    tmp.rename(work / f"{bx}-{by}.sqlite")

    # Contours are cut at z16 (~2 m), smoothed with the margin in hand so a
    # block edge is seamless, and the margin dropped before they are written.
    factor = 2 ** (zmax - 16)
    contour = filled
    for _ in range(zmax - 16):
        contour = dem.halve(contour)
    cell_m = float(dem.pixel_size_m(first_row + size // 2, 1, zmax)[0]) * factor
    valid = ~np.isnan(contour)
    smooth = pipeline._normalized_gaussian(
        np.nan_to_num(contour), valid, CONTOUR_SMOOTH_SIGMA_M / cell_m
    )
    cm = m // factor
    smooth = np.where(valid, smooth, NODATA)[cm:-cm, cm:-cm].astype(np.float32)
    ds = pipeline.gdal.GetDriverByName("GTiff").Create(
        str(work / f"contour-{bx}-{by}.tif"),
        smooth.shape[1],
        smooth.shape[0],
        1,
        pipeline.gdal.GDT_Float32,
        options=["COMPRESS=DEFLATE"],
    )
    ds.SetProjection(mercator_wkt())
    ds.SetGeoTransform(
        (west, span / smooth.shape[1], 0, north, 0, -span / smooth.shape[0])
    )
    ds.GetRasterBand(1).SetNoDataValue(NODATA)
    ds.GetRasterBand(1).WriteArray(smooth)
    ds = None
    return count


# ── Archives ─────────────────────────────────────────────────────────────────


def write_pmtiles(rows, out: Path, meta: dict) -> None:
    """XYZ (z, x, y, data) rows into a PMTiles archive, through MBTiles."""
    from pmtiles.convert import mbtiles_to_pmtiles

    mbtiles = out.with_suffix(".mbtiles")
    mbtiles.unlink(missing_ok=True)
    with contextlib.closing(sqlite3.connect(mbtiles)) as db:
        db.execute(
            "create table tiles (zoom_level integer, tile_column integer,"
            " tile_row integer, tile_data blob)"
        )
        db.execute("create table metadata (name text, value text)")
        # MBTiles rows are TMS: flipped from the XYZ rows used everywhere else.
        db.executemany(
            "insert into tiles values (?, ?, ?, ?)",
            ((z, x, (1 << z) - 1 - y, data) for z, x, y, data in rows),
        )
        db.executemany("insert into metadata values (?, ?)", meta.items())
        db.commit()
    mbtiles_to_pmtiles(str(mbtiles), str(out), None)
    mbtiles.unlink()


def range_bounds(tiles15: Tuple[int, int, int, int]) -> str:
    x0, y0, x1, y1 = tiles15
    west, north = dem.tile_lonlat(x0, y0, ZMIN)
    east, south = dem.tile_lonlat(x1 + 1, y1 + 1, ZMIN)
    return f"{west},{south},{east},{north}"


def raster_archives(work: Path, out: Path, tiles15, zmax: int, extracted: str):
    for layer, name in ((HEIGHTS, "heights"), (SLOPE, "slope")):

        def rows():
            for block in sorted(work.glob("*.sqlite")):
                with contextlib.closing(sqlite3.connect(block)) as db:
                    yield from db.execute(
                        "select z, x, y, data from tiles where layer = ?", (name,)
                    )

        write_pmtiles(
            rows(),
            out / f"{name}.pmtiles",
            {
                "name": layer.name,
                "format": "png",
                "type": "overlay",
                "encoding": "terrarium",
                "bounds": range_bounds(tiles15),
                "minzoom": str(ZMIN),
                "maxzoom": str(zmax),
                "attribution": credit(extracted),
            },
        )


def contour_archive(work: Path, out: Path, extracted: str) -> None:
    """10 m contours of the blocks' filled heights, as the statewide archive
    has them: one `contours` layer, an `elev` attribute, at z14 only."""
    from pmtiles.convert import mbtiles_to_pmtiles

    vrt = work / "contours.vrt"
    pipeline.gdal.BuildVRT(str(vrt), sorted(str(p) for p in work.glob("contour-*.tif")))
    raw = work / "contours.raw.gpkg"
    lines = work / "contours.gpkg"
    run(
        *["gdal_contour", "-q", "-a", "elev", "-i", str(dem.CONTOUR_INTERVAL_M)],
        *["-snodata", str(NODATA), "-f", "GPKG", str(vrt), str(raw), "-nln", "cont"],
    )
    for name, test in (("major", "="), ("minor", "<>")):
        run(
            *["ogr2ogr", "-q", "-f", "GPKG", "-update", "-append", str(lines)],
            *[str(raw), "-t_srs", "EPSG:4326", "-nln", name, "-sql"],
            "select elev, geom from cont where cast(elev as integer)"
            f" % {dem.CONTOUR_MAJOR_M} {test} 0",
        )
    mbtiles = out / "contours.mbtiles"
    mbtiles.unlink(missing_ok=True)
    z = CONTOUR_ZOOM
    conf = {
        name: {"target_name": dem.CONTOUR_LAYER, "minzoom": z, "maxzoom": z}
        for name in ("major", "minor")
    }
    run(
        *["ogr2ogr", "-q", "-f", "MVT", str(mbtiles), str(lines)],
        *["-dsco", "FORMAT=MBTILES", "-dsco", f"MINZOOM={z}", "-dsco", f"MAXZOOM={z}"],
        *["-dsco", f"CONF={json.dumps(conf)}"],
        *["-dsco", f"DESCRIPTION={credit(extracted).replace('Elevation', 'Contours')}"],
    )
    mbtiles_to_pmtiles(str(mbtiles), str(out / "contours.pmtiles"), z)
    mbtiles.unlink()


# ── Entry point ──────────────────────────────────────────────────────────────


def footprint_bbox(path: Path) -> Tuple[float, float, float, float]:
    from shapely.geometry import shape

    with open(path) as f:
        geometry = json.load(f)["features"][0]["geometry"]
    return tuple(round(v, 6) for v in shape(geometry).bounds)


def sharpen(args) -> dict:
    bench = pipeline.Benchmark()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="sharpen_") as tmp:
        work = Path(tmp)
        with bench.step("Extract", key="extract"):
            contents = pipeline.extract_elvis_zip(args.zip, str(work / "zip"))
        ground = str(work / "ground.tif")
        with bench.step("Ground", key="ground"):
            if contents.dem_files:
                kind = "elvis-dem"
                zmax = dem_ground(contents.dem_files, ground)
            else:
                kind = "class-2"
                zmax = laz_ground(contents.las_files, ground, work, args.workers)
        with bench.step("Footprint", key="footprint"):
            pipeline.compute_data_footprint(ground, str(out / "footprint.geojson"))
        coverage = footprint_bbox(out / "footprint.geojson")
        tiles15 = tile_range(coverage)
        blocks = blocks_of(tiles15)
        log.info(f"Ground: {kind}, zmax {zmax}, {len(blocks)} block(s)")

        blocks_dir = work / "blocks"
        blocks_dir.mkdir()
        tile_count = 0
        with (
            bench.step("Tiles", key="tiles"),
            ProcessPoolExecutor(
                args.workers,
                initializer=init_block_worker,
                initargs=(
                    args.statewide_heights,
                    args.statewide_slope,
                    ground,
                    zmax,
                    str(blocks_dir),
                ),
            ) as pool,
        ):
            futures = [pool.submit(sharpen_block, b) for b in blocks]
            for n, done in enumerate(as_completed(futures), 1):
                tile_count += done.result()
                pipeline._write_progress(n, len(blocks), "tiles")
        extracted = extraction_month(args.zip)
        with bench.step("Archives", key="archives"):
            raster_archives(blocks_dir, out, tiles15, zmax, extracted)
            contour_archive(blocks_dir, out, extracted)

    result = {
        "v": 1,
        "zmax": zmax,
        "tiles15": list(tiles15),
        "coverage": list(coverage),
        "ground": kind,
        "extracted": extracted,
    }
    (out / "sharpen.json").write_text(json.dumps(result))
    if args.metrics_json:
        bench.set_tile_counts(len(contents.las_files or contents.dem_files), tile_count)
        bench.set_zoom(ZMIN, zmax)
        bench.write_metrics(args.metrics_json)
    return result


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("zip")
    parser.add_argument("out")
    parser.add_argument("--statewide-heights", required=True)
    parser.add_argument("--statewide-slope", required=True)
    parser.add_argument("--workers", type=int, default=os.cpu_count() or 2)
    parser.add_argument("--progress-file")
    parser.add_argument("--metrics-json")
    args = parser.parse_args()
    pipeline._PROGRESS_PATH = args.progress_file
    try:
        sharpen(args)
    except CannotSharpen as e:
        Path(args.out).mkdir(parents=True, exist_ok=True)
        (Path(args.out) / "error.json").write_text(json.dumps({"sentence": str(e)}))
        sys.exit(2)


if __name__ == "__main__":
    main()
