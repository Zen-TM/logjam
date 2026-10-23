#!/usr/bin/env python3
"""
sharpen.py
----------
Sharpen an area: an ELVIS ZIP to the statewide terrain formats at the
survey's own cell, for a job the API marked to sharpen (`topo_jobs.sharpen`).

    sharpen.py ZIP OUT [--statewide-heights SRC] [--statewide-slope SRC]
                       [--workers N] [--progress-file P] [--metrics-json P]

SRC is a local `.pmtiles` path or `s3://bucket/key`; the default is the
published `nsw-5m.pmtiles` or `nsw-5m-slope.pmtiles` in $S3_BUCKET_TOPO.
OUT receives:

  heights.pmtiles   terrarium heights, z15 to zmax, a mean pyramid (ADR 0030)
  slope.pmtiles     terrarium slope in degrees, z15 to zmax, a max pyramid (ADR 0039)
  contours.pmtiles  10 m contours at z14, the statewide archive's schema;
                    absent when no 10 m level crosses the area
  footprint.geojson where the survey has ground
  sharpen.json      zmax, the tile range, coverage, ground kind, extraction
                    month, and the credit the clients show

A ZIP Logjam cannot sharpen writes `error.json` with the sentence its owner
reads (the `CannotSharpen` sentences: no ground classified, no ground with a
height, only 5 m DEMs, too big for memory) and exits 2.

Each archive holds every tile of one range: the z15 tiles over the
footprint's bbox, widened to whole z14 tiles, and all their descendants to
zmax (z14 for contours). Where the survey has no ground, a tile holds the
statewide 5 m data instead, so a client can take each tile from exactly one
archive and draw no seam.

Ground is the ZIP's ELVIS DEM when it has one finer than 5 m; otherwise the
survey's own class 2, as a TIN. Never a re-classification of the points: on
a classified survey that puts ground on the canopy.

PRIVACY: the footprint, the tile range, a tile index and a survey's name say
where the user surveyed. No log call names them (tests/test_log_privacy.py).
Work files are named by position, not by tile (tests/test_sharpen.py
`TestSharpenBlock`), but the ZIP's files keep their ELVIS names (survey and
MGA tile), and a failure's message can quote one: so a failure is reported
by its type and code locations only (`pipeline.report_failure`,
`TestReportFailure`), and PDAL's own output is captured, never printed.
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
from worker_common import TOO_BIG

log = logging.getLogger("sharpen")

# The first zoom finer than the statewide 5 m data: the archives start here,
# and the statewide layer draws every zoom above.
ZMIN = 15
CONTOUR_ZOOM = 14
# Pixel ground size at -34° is ~1.0 m at z17 and ~2.0 m at z16. A 1 m cell
# needs a ground point a square metre: a Category 2 survey's class 2 holds
# ~0.12 (measured on NSW tiles), so a 1 m grid of it is mostly interpolation.
DENSE_GROUND_PTS_M2 = 1.0
# Neighbouring tiles' ground read around a tile, so its TIN meets theirs.
TIN_BUFFER_M = 30
# A triangle longer than this spans a void (water, a gap in the survey), not
# ground: the cells under it take the statewide value instead.
TIN_MAX_EDGE_M = 50
# Pixels of context around a block: Horn needs one, the contour smoothing a
# few more at the contour grid.
MARGIN_PX = 16
NODATA = dem.NODATA

# The statewide archives' encodings (ADR 0030, ADR 0039), under their own names.
HEIGHTS = dataclasses.replace(dem.HEIGHTS, name="Sharpened heights", derived="")
SLOPE = dataclasses.replace(dem.SLOPE, name="Sharpened slope", derived="")

NO_GROUND = (
    "This ZIP's point clouds have no ground marked in them. Add the DEM ELVIS "
    "offers for the same area to the ZIP, and make it again."
)
EMPTY_GROUND = (
    "Logjam couldn't map any ground from this ZIP. Download the area again "
    "from ELVIS with its DEM, and make it again."
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


def dem_plan(
    dem_cells: List[Optional[float]], has_laz: bool
) -> Tuple[Optional[int], List[int]]:
    """Which ground a ZIP gives: (zmax, the DEMs to mosaic, coarse to fine)
    when it has a DEM finer than 5 m with heights in it, else (None, []) to
    grid its class 2. A cell is None for a DEM with no height at all (ELVIS
    sometimes bundles one).

    An empty DEM and a 5 m one add nothing, so both are dropped; a ZIP left
    with nothing to sharpen is refused, and one that still has point clouds
    falls to them. Coarse to fine, so where DEMs overlap the finest is drawn
    last and wins (tests/test_sharpen.py `TestGround`).
    """
    usable = [(c, i) for i, c in enumerate(dem_cells) if c and zoom_for_cell(c)]
    if usable:
        usable.sort(reverse=True)
        return zoom_for_cell(usable[-1][0]), [i for _, i in usable]
    if has_laz:
        return None, []
    if any(dem_cells):
        raise CannotSharpen(ONLY_5M)
    raise CannotSharpen(EMPTY_GROUND)


def class2_cell(ground_points: int, area_m2: float) -> int:
    """The cell a survey's class 2 supports, over the tiles that have any."""
    if ground_points == 0:
        raise CannotSharpen(NO_GROUND)
    return cell_for_density(ground_points / area_m2)


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


def mosaic_bounds(bx: int, by: int) -> Tuple[float, float, float, float]:
    """Web mercator bounds of `z15_mosaic`'s grid: the z14 block and one z15
    tile all round."""
    west, _, _, north = dem.tile_bounds_3857(ZMIN, 2 * bx - 1, 2 * by - 1)
    _, south, east, _ = dem.tile_bounds_3857(ZMIN, 2 * bx + 2, 2 * by + 2)
    return west, south, east, north


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
    """Heights rounded to ADR 0030's quarter metre at z15, halved each zoom
    deeper: the quarter metre was sized for z15's ~4 m pixels, and on 1 m
    pixels it draws terraces in the hillshade and puts up to ~7° of noise in
    a tapped slope (ADR 0030's update of 2026-10-24; tests/test_sharpen.py
    `TestPyramid`)."""
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


def extraction_month(zip_path: str) -> Optional[str]:
    """The month ELVIS packed the ZIP, from its newest entry: the date the
    licence asks a derived product to show. An entry whose date is not a date
    (a zero DOS date, as some re-zipping tools write) says nothing, so it is
    skipped; None when no entry has one."""
    dated = []
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            # zipfile decodes DOS dates with no range check: month 0 or 13,
            # day 0, hour 25 all come through.
            with contextlib.suppress(ValueError):
                dated.append(datetime(*info.date_time))
    return max(dated).strftime("%B %Y") if dated else None


def credit(extracted: Optional[str]) -> str:
    """What ELVIS metadata asks of a derived product (CC BY 3.0 AU)."""
    when = f", extracted {extracted}" if extracted else ""
    return (
        "Elevation: derived from a LiDAR survey, © Department of Customer"
        f" Service (NSW Spatial Services){when}. CC BY 3.0 AU."
    )


# ── Ground ───────────────────────────────────────────────────────────────────


def run(*command: str) -> str:
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout


def las_summary(path: str) -> dict:
    """Point count and XY bounds from the header, without reading the points."""
    return json.loads(run("pdal", "info", "--summary", path))["summary"]


def dem_cell(path: Path) -> Optional[float]:
    """A DEM's cell in metres, or None when it holds no height."""
    if not pipeline.raster_has_valid_pixels(str(path)):
        return None
    ds = pipeline.gdal.Open(str(path))
    cell = abs(ds.GetGeoTransform()[1])
    ds = None
    return cell


def dem_ground(dem_files: List[Path], order: List[int], out: str) -> None:
    """Mosaic the chosen DEMs at the finest one's cell, finest drawn last, a
    coarser one upsampled bilinear (tests/test_sharpen.py `TestGroundSteps`)."""
    pipeline.merge_dem_tiles(
        [dem_files[i] for i in order], out, resolution="highest", resample="bilinear"
    )


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


# Peak memory of one TIN job per ground point it reads: PDAL holds every point
# of every file it reads (its own tile's ground and its neighbours') and the
# mesh over them. Measured: 992 MiB for a Category 1 tile's 5.0 M
# ground points read alone, ~210 bytes a point.
TIN_BYTES_PER_POINT = 210
# Of the memory the container may still use, the share TIN jobs may take.
TIN_MEMORY_SHARE = 0.7


def tin_workers(cpus: int, window_points: int, memory_bytes: int) -> int:
    """TIN jobs at a time: one a CPU, and as many as the largest job's points
    fit in TIN_MEMORY_SHARE of the memory, but always one when it fits in all
    of it. An area whose largest job needs more than all of the memory is
    refused: run alone it would only end in an out-of-memory kill
    (tests/test_sharpen.py `TestTinWorkers`)."""
    need = TIN_BYTES_PER_POINT * max(window_points, 1)
    if need > memory_bytes:
        raise CannotSharpen(TOO_BIG)
    return max(1, min(cpus, int(TIN_MEMORY_SHARE * memory_bytes // need)))


def available_memory(
    meminfo: Path = Path("/proc/meminfo"), cgroup: Path = Path("/sys/fs/cgroup")
) -> int:
    """Bytes the job can still take, never below zero: the host's
    MemAvailable or, when the container has a cgroup v2 memory limit and it
    is lower, that limit less what the cgroup holds that it can't give back
    (memory.current less memory.stat's inactive_file, the page cache the
    kernel reclaims first: the extracted ZIP and the ground files are written
    before this is asked). Tests: tests/test_sharpen.py `TestTinWorkers`."""
    found = dict(line.split(":", 1) for line in meminfo.read_text().splitlines())
    free = int(found["MemAvailable"].split()[0]) * 1024
    with contextlib.suppress(OSError, ValueError, KeyError):
        limit = int((cgroup / "memory.max").read_text())  # "max": no limit
        stat = dict(
            line.split() for line in (cgroup / "memory.stat").read_text().splitlines()
        )
        held = int((cgroup / "memory.current").read_text()) - int(stat["inactive_file"])
        free = min(free, limit - held)
    return max(0, free)


def laz_ground(las_files: List[Path], out: str, work: Path, workers: int) -> int:
    """A TIN of the survey's class 2 over every terrain tile that has any;
    returns zmax."""
    terrain = pipeline.select_surveys_by_layer([str(f) for f in las_files])
    paths = terrain.terrain_tiles
    tiles = []  # (ground file, bounds, ground points) of tiles with ground
    for i, path in enumerate(paths):
        b = las_summary(path)["bounds"]
        ground = str(work / f"ground-{i}.las")
        run(
            *["pdal", "translate", path, ground, "range"],
            "--filters.range.limits=Classification[2:2]",
        )
        count = int(las_summary(ground)["num_points"])
        if count:
            tiles.append((ground, b, count))
        pipeline._write_progress(i + 1, len(paths), "ground")
    total = sum(count for *_, count in tiles)
    area = sum((b["maxx"] - b["minx"]) * (b["maxy"] - b["miny"]) for _, b, _ in tiles)
    cell = class2_cell(total, area)

    def near(a: dict, c: dict) -> bool:
        return not (
            c["minx"] > a["maxx"] + TIN_BUFFER_M
            or c["maxx"] < a["minx"] - TIN_BUFFER_M
            or c["miny"] > a["maxy"] + TIN_BUFFER_M
            or c["maxy"] < a["miny"] - TIN_BUFFER_M
        )

    jobs, window = [], 0
    for i, (_, b, _) in enumerate(tiles):
        around = [(g, c) for g, nb, c in tiles if near(b, nb)]
        window = max(window, sum(c for _, c in around))
        out_i = str(work / f"tin-{i}.tif")
        jobs.append((str(i), b, [g for g, _ in around], float(cell), out_i, str(work)))
    n = tin_workers(workers, window, available_memory())
    log.info(
        f"{len(tiles)} of {len(paths)} tile(s) with ground, "
        f"{total / area:.2f} pts/m² → {cell} m cell, {n} TIN job(s) at a time"
    )
    tins = []
    with ProcessPoolExecutor(n) as pool:
        futures = [pool.submit(_tin_tile, j) for j in jobs]
        for k, done in enumerate(as_completed(futures), 1):
            tins.append(Path(done.result()))
            # The reaper fails a job whose progress stalls for
            # TOPO_REAPER_PROGRESS_STALL_MS (api/src/lib/env.ts); a dense area
            # runs one long TIN job at a time.
            pipeline._write_progress(k, len(jobs), "tin")
    pipeline.merge_dem_tiles(sorted(tins), out)
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


def sharpen_block(block: Tuple[int, int, int]) -> int:
    """Heights and slope tiles of the i-th z14 block, (i, bx, by), into its
    own file, and its filled heights at the contour grid. Returns the tile
    count. Files are named by i, never by the tile they hold."""
    i, bx, by = block
    zmax, work = _ctx["zmax"], _ctx["work"]
    size = 2 * dem.TILE * 2 ** (zmax - ZMIN)
    m = MARGIN_PX
    west, south, east, north = dem.tile_bounds_3857(CONTOUR_ZOOM, bx, by)
    px = (east - west) / size
    outer = (west - m * px, south - m * px, east + m * px, north + m * px)

    ground = _warp(_ctx["ground"], outer, size + 2 * m, "bilinear")
    span = east - west
    up = {}
    for name in ("heights", "slope"):
        mosaic = z15_mosaic(lambda x, y: statewide_tile(_ctx[name], x, y), bx, by)
        up[name] = _warp(
            _mem(mosaic, mosaic_bounds(bx, by)), outer, size + 2 * m, "bilinear"
        )

    first_row = by * size
    heights, slope, filled = block_grids(
        ground, up["heights"], up["slope"], first_row, zmax
    )

    done = work / f"block-{i}.sqlite"
    tmp = done.with_suffix(".tmp")
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
    tmp.rename(done)

    # Contours are cut at z16 (~2 m), smoothed with the margin in hand so a
    # block edge is seamless, and the margin dropped before they are written.
    factor = 2 ** (zmax - 16)
    contour = filled
    for _ in range(zmax - 16):
        contour = dem.halve(contour)
    cell_m = float(dem.pixel_size_m(first_row + size // 2, 1, zmax)[0]) * factor
    valid = ~np.isnan(contour)
    smooth = pipeline._normalized_gaussian(
        np.nan_to_num(contour), valid, pipeline.CONTOUR_SMOOTH_SIGMA_M / cell_m
    )
    cm = m // factor
    smooth = np.where(valid, smooth, NODATA)[cm:-cm, cm:-cm].astype(np.float32)
    ds = pipeline.gdal.GetDriverByName("GTiff").Create(
        str(work / f"contour-{i}.tif"),
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
        # The converter looks every tile up by its key: without the index
        # that is a scan per tile, minutes per layer on a large area.
        db.execute(
            "create unique index tile_index on tiles"
            " (zoom_level, tile_column, tile_row)"
        )
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
            for block in sorted(work.glob("block-*.sqlite")):
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


def contour_archive(work: Path, out: Path, extracted: Optional[str]) -> bool:
    """10 m contours of the blocks' filled heights, as the statewide archive
    has them: one `contours` layer, an `elev` attribute, at z14 only. False,
    and no archive, when no 10 m level crosses the area: the statewide
    contours then show there (tests/test_sharpen.py `TestContourArchive`)."""
    from pmtiles.convert import mbtiles_to_pmtiles

    vrt = work / "contours.vrt"
    pipeline.gdal.BuildVRT(str(vrt), sorted(str(p) for p in work.glob("contour-*.tif")))
    raw = work / "contours.raw.gpkg"
    lines = work / "contours.gpkg"
    dem.contour_lines(vrt, raw, lines, run=run)
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
    has_tiles = False
    if mbtiles.exists():
        with contextlib.closing(sqlite3.connect(mbtiles)) as db:
            has_tiles = db.execute("select count(*) from tiles").fetchone()[0] > 0
    if has_tiles:
        mbtiles_to_pmtiles(str(mbtiles), str(out / "contours.pmtiles"), z)
    mbtiles.unlink(missing_ok=True)
    return has_tiles


# ── Entry point ──────────────────────────────────────────────────────────────


def require_ground(ground: str) -> None:
    """Refuse a ground grid with no height in it: a DEM of no-data, or class 2
    too sparse for any triangle. The footprint would otherwise fall back to
    the whole grid, and the job would claim an area it has no ground for
    (tests/test_sharpen.py `TestGroundSteps`)."""
    if not pipeline.raster_has_valid_pixels(ground):
        raise CannotSharpen(EMPTY_GROUND)


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
        extracted = extraction_month(args.zip)
        ground = str(work / "ground.tif")
        with bench.step("Ground", key="ground"):
            cells = [dem_cell(p) for p in contents.dem_files]
            zmax, order = dem_plan(cells, bool(contents.las_files))
            if order:
                kind = "elvis-dem"
                dem_ground(contents.dem_files, order, ground)
            else:
                kind = "class-2"
                zmax = laz_ground(contents.las_files, ground, work, args.workers)
        require_ground(ground)
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
            futures = [
                pool.submit(sharpen_block, (i, bx, by))
                for i, (bx, by) in enumerate(blocks)
            ]
            for n, done in enumerate(as_completed(futures), 1):
                tile_count += done.result()
                pipeline._write_progress(n, len(blocks), "tiles")
        with bench.step("Archives", key="archives"):
            raster_archives(blocks_dir, out, tiles15, zmax, extracted)
            if not contour_archive(blocks_dir, out, extracted):
                log.info("No 10 m contour crosses the area: no contour archive")

    result = {
        "v": 1,
        "zmax": zmax,
        "tiles15": list(tiles15),
        "coverage": list(coverage),
        "ground": kind,
        "extracted": extracted,
        # What the clients credit for the area: declared once, here.
        "credit": credit(extracted),
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
    bucket = os.environ.get("S3_BUCKET_TOPO", "")
    parser.add_argument(
        "--statewide-heights", default=f"s3://{bucket}/{dem.HEIGHT_KEY}"
    )
    parser.add_argument("--statewide-slope", default=f"s3://{bucket}/{dem.SLOPE_KEY}")
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
    except Exception as e:  # noqa: BLE001 - every failure, told without its message
        print(pipeline.report_failure(e, "sharpen"), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
