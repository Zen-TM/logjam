#!/usr/bin/env python3
"""
topo_mbtiles.py
---------------
Converts an ELVIS (NSW Spatial Services) LiDAR ZIP into a set of raster MBTiles
files suitable for import into Gaia GPS.

Auto-detects ZIP contents and selects the fastest available pipeline:

  Mode A – DEM only    (.tif found, no .laz/.las)
    → Skips all PDAL processing. Fastest. No vegetation layer.

  Mode B – DEM + LAZ   (.tif AND .laz/.las found)
    → Uses pre-built DEM for DTM. Runs PDAL density pass (hag_dem) for vegetation.
    → ~30–40% faster than LAZ-only. All layers available.

  Mode C – LAZ only    (.laz/.las found, no .tif)
    → Full PDAL DTM+DSM pipeline. Slowest. All layers available.

Outputs (in ./output/):
  - hillshade.mbtiles
  - vegetation.mbtiles   (Modes B and C only)
  - features.mbtiles
  - slope.mbtiles
  - contours.mbtiles
  - composite.mbtiles    ← all available layers composited

Usage:
  python topo_mbtiles.py /path/to/elvis_download.zip [--workers N] [--output ./output]
  python topo_mbtiles.py /path/to/elvis_download.zip --benchmark
"""

import argparse
import json
import logging
import math
import multiprocessing
import os
import shutil
import sqlite3
import struct
import subprocess
import sys
import tempfile
import time
import zipfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Generator, List, Optional, Tuple

import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFont
from osgeo import gdal, ogr, osr
from shapely.geometry import shape, mapping, Polygon, MultiPolygon, box as shapely_box
from shapely.ops import unary_union

gdal.UseExceptions()
ogr.UseExceptions()

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("topo")

# ---------------------------------------------------------------------------
# Benchmark timer
# ---------------------------------------------------------------------------

class Benchmark:
    """Accumulates per-step wall-clock timings and prints a summary."""

    def __init__(self, enabled: bool = False):
        self.enabled = enabled
        self._steps: List[Tuple[str, float]] = []   # (label, elapsed_seconds)
        self._wall_start: float = time.monotonic()

    @contextmanager
    def step(self, label: str):
        if not self.enabled:
            yield
            return
        t0 = time.monotonic()
        log.info(f"[BENCH] ▶  {label} …")
        try:
            yield
        finally:
            elapsed = time.monotonic() - t0
            self._steps.append((label, elapsed))
            log.info(f"[BENCH] ✓  {label} — {_fmt_duration(elapsed)}")

    def report(self):
        if not self.enabled or not self._steps:
            return
        total_wall = time.monotonic() - self._wall_start
        col = max(len(s[0]) for s in self._steps) + 2
        bar_max = 40
        max_t = max(s[1] for s in self._steps) or 1

        lines = [
            "",
            "═" * (col + bar_max + 20),
            f"  BENCHMARK REPORT",
            "═" * (col + bar_max + 20),
        ]
        for label, elapsed in self._steps:
            bar_len = int(elapsed / max_t * bar_max)
            bar = "█" * bar_len + "░" * (bar_max - bar_len)
            pct = elapsed / total_wall * 100
            lines.append(f"  {label:<{col}} {bar}  {_fmt_duration(elapsed):>10}  ({pct:4.1f}%)")

        lines += [
            "─" * (col + bar_max + 20),
            f"  {'Total wall time':<{col}} {'':>{bar_max}}  {_fmt_duration(total_wall):>10}",
            "═" * (col + bar_max + 20),
            "",
        ]
        print("\n".join(lines))


def _fmt_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.1f}s"
    m, s = divmod(int(seconds), 60)
    if m < 60:
        return f"{m}m {s:02d}s"
    h, m = divmod(m, 60)
    return f"{h}h {m:02d}m {s:02d}s"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
TILE_SIZE = 256          # pixels per tile edge
WEB_MERCATOR_EPSG = 3857
WGS84_EPSG = 4326
ZOOM_MIN = 12
ZOOM_MAX = 18

# Vegetation (scrub density) layer — for bushbashing avoidance.
# Normalized Relative Density (NRD): walking-height returns (0.25–2.0 m HAG)
# divided by walking-height + everything-below (HAG ≤ 2.0 m including ground).
# Including ground in the denominator corrects for canopy occlusion: where the
# canopy absorbs most pulses, the few that reach the ground floor still
# normalize the scrub-band count instead of producing wild ratios from tiny
# denominators.
# After per-cell NRD is computed, a count-weighted bilateral filter smooths it
# while preserving scrub-patch edges.
SCRUB_DENSITY_FILTER_WINDOW_M = 9     # 9×9 m bilateral window (≈4.5 m radius)
SCRUB_DENSITY_SIGMA_SPATIAL_M = 3.0   # spatial Gaussian σ (metres / cells, 1m grid)
SCRUB_DENSITY_SIGMA_RANGE     = 0.15  # intensity Gaussian σ in NRD units
SCRUB_DENSITY_MIN_PULSES      = 12    # min windowed (scrub+below) pulse count for a valid cell
SCRUB_DENSITY_MIN_RATIO       = 0.05  # below this → transparent (NRD runs lower than old ratio)
SCRUB_DENSITY_MAX_RATIO       = 0.45  # at/above → fully opaque dark green

# PDAL noise/overlap classification codes per ASPRS LAS spec (dropped during count):
#   7  = Low noise
#   12 = Overlap (flight-line redundancy)
#   18 = High noise
PDAL_DROP_CLASSES_EXPR = (
    "Classification != 7 && Classification != 12 && Classification != 18"
)
# Drop swath-edge points where understory penetration is poor.
PDAL_SCAN_ANGLE_MAX = 20

# SVTM formation raster served from S3 via GDAL's /vsis3/ virtual filesystem.
# GDAL reads only the tiles covering the job AOI — the full NSW-wide raster
# never loads into memory. Set GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR in the
# ECS task environment to suppress the S3 directory listing GDAL would
# otherwise attempt when opening a /vsis3/ path.
#
# Override via env var SVTM_FORMATION_S3_PATH (s3://bucket/key form).
# Set to an empty string to skip SVTM weighting entirely.
_svtm_s3_raw = os.environ.get(
    "SVTM_FORMATION_S3_PATH",
    "s3://logjam-topo-jobs/svtm/svtm_formation.tif",
)
SVTM_FORMATION_RASTER: str = (
    "/vsis3/" + _svtm_s3_raw.removeprefix("s3://") if _svtm_s3_raw else ""
)

# Formation → navigational-resistance multiplier μ.
# Multiplies the structural NRD so hard/thorny vegetation (Heathlands,
# Dry Sclerophyll) reads as harder going than clear-floored vegetation
# (Rainforest, Grasslands) at the same LiDAR point density.
# Formation index order must match build_svtm_formation.py exactly.
# Index 0 is always "Not classified" (μ=1.0).
SVTM_FORMATION_MU: Dict[str, float] = {
    "Not classified":                                      1.0,
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
}

# Slope thresholds (degrees) → RGBA colour
SLOPE_COLOURS = [
    (40, 50, (255, 255,   0, 140)),   # yellow
    (50, 60, (255, 165,   0, 160)),   # orange
    (60, 70, (220,  38,  38, 180)),   # red
    (70, 90, (120,   0,   0, 200)),   # dark red
]

# Contour intervals visible at each zoom level
# (zoom_min_inclusive, zoom_max_inclusive) → interval_metres
CONTOUR_ZOOM_INTERVALS = [
    (12, 15, 50),
    (15, 16, 10),
    (17, 18, 5),
]

# Line thickness for contours in ground metres (will be converted to pixels at render time)
CONTOUR_MAJOR_WIDTH_M = 18   # 50 m contours
CONTOUR_MINOR_WIDTH_M = 8    # 10 m / 5 m contours

# OSM Overpass query tags for topo-relevant features
OSM_FEATURE_QUERIES = {
    "waterway":   '["waterway"~"river|stream|creek|drain|canal|ditch"]',
    "track":      '["highway"~"track|path|footway|bridleway|steps"]',
    "road":       '["highway"~"primary|secondary|tertiary|unclassified|residential|service"]',
    "building":   '["building"]',
    "power":      '["power"~"line|minor_line|cable"]',
    "campsite":   '["tourism"~"camp_site|caravan_site|wilderness_hut|alpine_hut"]',
    "peak":       '["natural"~"peak|saddle|cliff|ridge|volcano"]',
    "spring":     '["natural"="spring"]',
    "gate":       '["barrier"~"gate|lift_gate|cycle_barrier"]',
    "viewpoint":  '["tourism"="viewpoint"]',
    "cave":       '["natural"="cave_entrance"]',
    "picnic":     '["tourism"="picnic_site"]',
}

# Per-feature render style  (zoom-relative: width at z18, scaled down at lower zooms)
OSM_STYLES = {
    "waterway":  {"colour": (40, 120, 220, 220),  "width_z18": 3,  "dash": None},
    "track":     {"colour": (160, 100,  30, 220),  "width_z18": 2,  "dash": (8, 4)},
    "road":      {"colour": (80,   80,  80, 230),  "width_z18": 4,  "dash": None},
    "building":  {"colour": (160, 140, 120, 200),  "width_z18": 2,  "dash": None, "fill": (160, 140, 120, 60)},
    "power":     {"colour": (200, 160,   0, 200),  "width_z18": 1,  "dash": (4, 6)},
    "campsite":  {"colour": (0,   160,  80, 230),  "point": True,   "symbol": "▲", "size_z18": 14},
    "peak":      {"colour": (100,  60,  20, 240),  "point": True,   "symbol": "▲", "size_z18": 12},
    "spring":    {"colour": (40,  100, 220, 220),  "point": True,   "symbol": "●", "size_z18": 8},
    "gate":      {"colour": (80,   80,  80, 200),  "point": True,   "symbol": "×", "size_z18": 10},
    "viewpoint": {"colour": (200, 100,   0, 220),  "point": True,   "symbol": "◉", "size_z18": 12},
    "cave":      {"colour": (80,   40,  10, 220),  "point": True,   "symbol": "◆", "size_z18": 10},
    "picnic":    {"colour": (0,   140,  60, 220),  "point": True,   "symbol": "■", "size_z18": 10},
}

# ---------------------------------------------------------------------------
# Tile maths
# ---------------------------------------------------------------------------

def lon_lat_to_tile(lon: float, lat: float, zoom: int) -> Tuple[int, int]:
    n = 2 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n)
    return x, y


def tile_to_bbox(x: int, y: int, zoom: int) -> Tuple[float, float, float, float]:
    """Return (lon_min, lat_min, lon_max, lat_max) for a tile."""
    n = 2 ** zoom
    lon_min = x / n * 360.0 - 180.0
    lon_max = (x + 1) / n * 360.0 - 180.0
    lat_max = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    lat_min = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return lon_min, lat_min, lon_max, lat_max


def tile_bbox_mercator(x: int, y: int, zoom: int) -> Tuple[float, float, float, float]:
    """Return (xmin, ymin, xmax, ymax) in Web Mercator metres."""
    lon_min, lat_min, lon_max, lat_max = tile_to_bbox(x, y, zoom)
    def to_merc(lon, lat):
        R = 6378137.0
        mx = R * math.radians(lon)
        my = R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
        return mx, my
    xmin, ymax = to_merc(lon_min, lat_max)
    xmax, ymin = to_merc(lon_max, lat_min)
    return xmin, ymin, xmax, ymax


def ground_metres_per_pixel(zoom: int) -> float:
    """Approximate ground resolution at the equator for a given zoom level."""
    earth_circumference = 2 * math.pi * 6378137.0
    return earth_circumference / (TILE_SIZE * 2 ** zoom)


def tiles_for_bbox(lon_min, lat_min, lon_max, lat_max, zoom) -> Generator[Tuple[int,int], None, None]:
    x0, y0 = lon_lat_to_tile(lon_min, lat_max, zoom)
    x1, y1 = lon_lat_to_tile(lon_max, lat_min, zoom)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            yield x, y

# ---------------------------------------------------------------------------
# MBTiles helpers
# ---------------------------------------------------------------------------

def create_mbtiles(path: str, name: str, description: str = "") -> sqlite3.Connection:
    # Schema matches exactly what QGIS produces (confirmed working in Gaia):
    # - lowercase column types, no NOT NULL, no PRIMARY KEY on tiles
    # - UNIQUE INDEX only, no extra indexes
    # - no 'scheme' metadata field
    conn = sqlite3.connect(path)
    c = conn.cursor()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS metadata (name text, value text);
        CREATE TABLE IF NOT EXISTS tiles (
            zoom_level  integer,
            tile_column integer,
            tile_row    integer,
            tile_data   blob
        );
        CREATE UNIQUE INDEX IF NOT EXISTS tile_index
            ON tiles (zoom_level, tile_column, tile_row);
    """)
    meta = [
        ("name",        name),
        ("type",        "overlay"),
        ("version",     "1.1"),
        ("description", description),
        ("format",      "png"),
        ("minzoom",     str(ZOOM_MIN)),
        ("maxzoom",     str(ZOOM_MAX)),
    ]
    for k, v in meta:
        c.execute("INSERT OR REPLACE INTO metadata (name, value) VALUES (?,?)", (k, v))
    conn.commit()
    return conn


def insert_tile(conn: sqlite3.Connection, z: int, x: int, y: int, png_bytes: bytes):
    """Insert one tile. MBTiles Y axis is TMS (flipped from XYZ)."""
    tms_y = (2 ** z - 1) - y
    conn.execute(
        "INSERT OR REPLACE INTO tiles VALUES (?,?,?,?)",
        (z, x, tms_y, sqlite3.Binary(png_bytes)),
    )


def finalise_bounds(conn: sqlite3.Connection, lon_min, lat_min, lon_max, lat_max):
    # Round to 6dp — full float precision in bounds strings causes parse
    # failures in some MBTiles consumers including older Gaia versions.
    lo_lon = round(lon_min, 6)
    lo_lat = round(lat_min, 6)
    hi_lon = round(lon_max, 6)
    hi_lat = round(lat_max, 6)
    cx     = round((lo_lon + hi_lon) / 2, 6)
    cy     = round((lo_lat + hi_lat) / 2, 6)
    bounds = f"{lo_lon},{lo_lat},{hi_lon},{hi_lat}"
    center = f"{cx},{cy},{(ZOOM_MIN + ZOOM_MAX) // 2}"
    conn.execute("INSERT OR REPLACE INTO metadata VALUES ('bounds',?)", (bounds,))
    conn.execute("INSERT OR REPLACE INTO metadata VALUES ('center',?)", (center,))
    conn.commit()

# ---------------------------------------------------------------------------
# Step 1 – Extract and inspect the ELVIS ZIP
# ---------------------------------------------------------------------------

# Pipeline mode constants
MODE_LAZ_ONLY  = "C"   # Full PDAL DTM + DSM
MODE_DEM_LAZ   = "B"   # Pre-built DEM + PDAL DSM only
MODE_DEM_ONLY  = "A"   # Pre-built DEM only – no vegetation layer

@dataclass
class ElvisContents:
    mode: str                        # MODE_* constant
    las_files: List[Path]            # .laz/.las files (may be empty)
    dem_files: List[Path]            # .tif DEM files (may be empty)
    has_vegetation: bool             # whether CHM can be built

    def describe(self) -> str:
        lines = ["  Pipeline mode : " + self.mode]
        if self.dem_files:
            lines.append(f"  DEM files     : {len(self.dem_files)} GeoTIFF(s)")
        if self.las_files:
            lines.append(f"  LAZ/LAS files : {len(self.las_files)} point cloud(s)")
        lines.append(f"  Vegetation    : {'✓ available' if self.has_vegetation else '✗ not available (no LAZ/LAS for DSM)'}")
        return "\n".join(lines)


def extract_elvis_zip(zip_path: str, work_dir: str) -> ElvisContents:
    """
    Unzip and detect what ELVIS has provided, choosing the fastest pipeline.

    Priority:
      - .tif files    → treat as pre-built DEM (skip DTM PDAL pass)
      - .laz/.las     → point clouds (needed for DSM / vegetation)
    """
    log.info(f"Extracting {zip_path} …")
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(work_dir)

    las_files = list(Path(work_dir).rglob("*.laz")) + list(Path(work_dir).rglob("*.las"))
    all_tifs = list(Path(work_dir).rglob("*.tif")) + list(Path(work_dir).rglob("*.tiff"))
    # Exclude any derivative products that might be bundled in some ELVIS packages
    dem_files = [t for t in all_tifs if not any(
        kw in t.stem.lower() for kw in ("hillshade", "slope", "aspect", "colour", "color", "rgb")
    )]

    if not las_files and not dem_files:
        raise RuntimeError(
            "No usable files found in ZIP. Expected .laz/.las point clouds "
            "and/or .tif DEM rasters."
        )

    if dem_files and las_files:
        mode = MODE_DEM_LAZ
        has_veg = True
    elif dem_files:
        mode = MODE_DEM_ONLY
        has_veg = False
    else:
        mode = MODE_LAZ_ONLY
        has_veg = True

    contents = ElvisContents(
        mode=mode,
        las_files=las_files,
        dem_files=dem_files,
        has_vegetation=has_veg,
    )

    mode_labels = {
        MODE_LAZ_ONLY: "C – LAZ only  (full PDAL DTM + DSM pipeline)",
        MODE_DEM_LAZ:  "B – DEM + LAZ (pre-built DEM; PDAL DSM-only for vegetation)",
        MODE_DEM_ONLY: "A – DEM only  (fastest; vegetation layer unavailable)",
    }
    log.info(f"ELVIS contents detected:\n{contents.describe()}")
    log.info(f"Selected pipeline mode {mode_labels[mode]}")

    if not has_veg:
        log.warning(
            "No LAZ/LAS files found — vegetation layer will be SKIPPED. "
            "If you want the vegetation layer, include LAZ files in the ZIP."
        )

    return contents

# ---------------------------------------------------------------------------
# Step 2 – Point cloud → DSM / DTM rasters via PDAL
# ---------------------------------------------------------------------------

def build_pipeline_full(las_files: List[str], out_dtm: str,
                        out_scrub_count: str, out_below_count: str,
                        resolution: float = 1.0) -> dict:
    """PDAL pipeline: LAZ → DTM (ground) + NRD count rasters. Mode C.

    Uses filters.smrf for ground classification and filters.hag_nn to assign
    HeightAboveGround to every point. Two count rasters drive NRD:
      - scrub_count: points with 0.25 ≤ HAG ≤ 2.0 m (walking-height scrub)
      - below_count: points with HAG < 0.25 m (ground + low litter)

    NRD = scrub_count / (scrub_count + below_count) — the proportion of pulses
    reaching ≤2.0 m that were intercepted by the walking-height layer rather
    than passing through to the ground. Including ground returns in the
    denominator compensates for canopy occlusion.

    A noise/overlap-class filter and a ±20° scan-angle gate apply to both
    count rasters (but NOT the DTM, which still needs all ground returns
    regardless of scan angle).
    """
    # Note on classification: filters.assign below wipes incoming Classification
    # to 0 so smrf has a clean slate to assign 1 (unclassified) / 2 (ground).
    # That destroys ASPRS noise/overlap codes (7/12/18). To preserve them for
    # downstream filtering, we drop those points BEFORE the assign step using
    # filters.range — it removes points outright rather than reclassifying.
    # PDAL filter expression parser has no function support (no abs()), so
    # the scan-angle gate is written as an explicit range comparison.
    count_where = (
        f"HeightAboveGround >= 0.25 && HeightAboveGround <= 2.0 "
        f"&& ScanAngleRank >= -{PDAL_SCAN_ANGLE_MAX} "
        f"&& ScanAngleRank <= {PDAL_SCAN_ANGLE_MAX}"
    )
    below_where = (
        f"HeightAboveGround < 0.25 "
        f"&& ScanAngleRank >= -{PDAL_SCAN_ANGLE_MAX} "
        f"&& ScanAngleRank <= {PDAL_SCAN_ANGLE_MAX}"
    )
    readers = [{"type": "readers.las", "filename": f} for f in las_files]
    return {
        "pipeline": readers + [
            {"type": "filters.reprojection", "out_srs": f"EPSG:{WEB_MERCATOR_EPSG}"},
            # Drop ASPRS noise (7, 18) and overlap (12) points before smrf
            # touches Classification.
            {"type": "filters.range",
             "limits": "Classification![7:7],Classification![12:12],Classification![18:18]"},
            {"type": "filters.assign", "assignment": "Classification[:]=0"},
            {"type": "filters.smrf"},
            {"type": "filters.hag_nn"},
            # DTM: mean elevation of ground-classified points.
            {
                "type": "writers.gdal",
                "filename": out_dtm,
                "resolution": resolution,
                "output_type": "mean",
                "where": "Classification == 2",
                "nodata": -9999,
                "gdalopts": "COMPRESS=LZW",
            },
            # Scrub band return count (0.25–2.0 m above ground).
            {
                "type": "writers.gdal",
                "filename": out_scrub_count,
                "resolution": resolution,
                "output_type": "count",
                "where": count_where,
                "nodata": 0,
                "gdalopts": "COMPRESS=LZW",
            },
            # Below-band return count (HAG < 0.25 m: ground + low litter).
            {
                "type": "writers.gdal",
                "filename": out_below_count,
                "resolution": resolution,
                "output_type": "count",
                "where": below_where,
                "nodata": 0,
                "gdalopts": "COMPRESS=LZW",
            },
        ]
    }


def build_pipeline_density_only(las_files: List[str], dtm_path: str,
                                 out_scrub_count: str, out_below_count: str,
                                 resolution: float = 1.0) -> dict:
    """PDAL pipeline: LAZ → NRD count rasters using an external DEM. Mode B.

    Uses filters.hag_dem to compute HeightAboveGround from a pre-built DEM raster,
    avoiding the need to re-run ground classification (smrf) when a DEM already exists.
    Requires PDAL ≥ 2.4 (available via UbuntuGIS unstable on Ubuntu 24.04).

    Drops ASPRS noise (7, 18) and overlap (12) classifications, and gates
    points to scan angles ≤ ±20° to remove swath-edge attenuation bias.
    """
    # PDAL filter expression parser has no function support (no abs()), so
    # the scan-angle gate is written as an explicit range comparison.
    count_where = (
        f"HeightAboveGround >= 0.25 && HeightAboveGround <= 2.0 "
        f"&& ScanAngleRank >= -{PDAL_SCAN_ANGLE_MAX} "
        f"&& ScanAngleRank <= {PDAL_SCAN_ANGLE_MAX}"
    )
    below_where = (
        f"HeightAboveGround < 0.25 "
        f"&& ScanAngleRank >= -{PDAL_SCAN_ANGLE_MAX} "
        f"&& ScanAngleRank <= {PDAL_SCAN_ANGLE_MAX}"
    )
    readers = [{"type": "readers.las", "filename": f} for f in las_files]
    return {
        "pipeline": readers + [
            {"type": "filters.reprojection", "out_srs": f"EPSG:{WEB_MERCATOR_EPSG}"},
            # Mode B preserves original Classification (no assign/smrf), so
            # noise/overlap codes survive — drop them outright.
            {"type": "filters.range",
             "limits": "Classification![7:7],Classification![12:12],Classification![18:18]"},
            {"type": "filters.hag_dem", "raster": dtm_path},
            # Scrub band return count (0.25–2.0 m above ground).
            {
                "type": "writers.gdal",
                "filename": out_scrub_count,
                "resolution": resolution,
                "output_type": "count",
                "where": count_where,
                "nodata": 0,
                "gdalopts": "COMPRESS=LZW",
            },
            # Below-band return count (HAG < 0.25 m: ground + low litter).
            {
                "type": "writers.gdal",
                "filename": out_below_count,
                "resolution": resolution,
                "output_type": "count",
                "where": below_where,
                "nodata": 0,
                "gdalopts": "COMPRESS=LZW",
            },
        ]
    }


def _merge_raster_tiles(tile_paths: List[str], out_path: str):
    """Mosaic per-tile PDAL GeoTIFFs into one. All inputs share the same CRS."""
    if len(tile_paths) == 1:
        shutil.copy2(tile_paths[0], out_path)
        return
    vrt_path = out_path.replace(".tif", "_merge.vrt")
    gdal.BuildVRT(vrt_path, tile_paths)
    gdal.Warp(out_path, vrt_path, creationOptions=["COMPRESS=LZW"])


def run_pdal_pipeline(pipeline: dict, work_dir: str, label: str = "pipeline"):
    pipeline_path = os.path.join(work_dir, f"{label}.json")
    with open(pipeline_path, "w") as f:
        json.dump(pipeline, f)
    log.info("Running PDAL pipeline (this is the longest step) …")
    result = subprocess.run(
        ["pdal", "pipeline", pipeline_path],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"PDAL failed:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")
    log.info("PDAL pipeline complete.")


def run_pdal_sequential_full(las_files: List[str], out_dtm: str,
                              out_scrub_count: str, out_below_count: str,
                              work_dir: str, resolution: float = 1.0):
    """Process LAZ files one at a time (DTM + NRD counts), then merge. Mode C."""
    dtm_tiles = []
    scrub_tiles = []
    below_tiles = []
    for i, laz in enumerate(las_files):
        log.info(f"PDAL tile {i+1}/{len(las_files)}: {os.path.basename(laz)}")
        tile_dtm   = os.path.join(work_dir, f"dtm_tile_{i}.tif")
        tile_scrub = os.path.join(work_dir, f"scrub_tile_{i}.tif")
        tile_below = os.path.join(work_dir, f"below_tile_{i}.tif")
        pipeline = build_pipeline_full([laz], tile_dtm, tile_scrub, tile_below, resolution)
        run_pdal_pipeline(pipeline, work_dir, label=f"pipeline_full_{i}")
        dtm_tiles.append(tile_dtm)
        scrub_tiles.append(tile_scrub)
        below_tiles.append(tile_below)

    log.info(f"Merging {len(dtm_tiles)} DTM tiles …")
    _merge_raster_tiles(dtm_tiles, out_dtm)
    log.info(f"Merging {len(scrub_tiles)} scrub-count tiles …")
    _merge_raster_tiles(scrub_tiles, out_scrub_count)
    log.info(f"Merging {len(below_tiles)} below-count tiles …")
    _merge_raster_tiles(below_tiles, out_below_count)

    for p in dtm_tiles + scrub_tiles + below_tiles:
        os.remove(p)


def run_pdal_sequential_density(las_files: List[str], dtm_path: str,
                                 out_scrub_count: str, out_below_count: str,
                                 work_dir: str, resolution: float = 1.0):
    """Process LAZ files one at a time (NRD counts only) using hag_dem. Mode B."""
    scrub_tiles = []
    below_tiles = []
    for i, laz in enumerate(las_files):
        log.info(f"PDAL tile {i+1}/{len(las_files)}: {os.path.basename(laz)}")
        tile_scrub = os.path.join(work_dir, f"scrub_tile_{i}.tif")
        tile_below = os.path.join(work_dir, f"below_tile_{i}.tif")
        pipeline = build_pipeline_density_only([laz], dtm_path, tile_scrub, tile_below, resolution)
        run_pdal_pipeline(pipeline, work_dir, label=f"pipeline_density_{i}")
        scrub_tiles.append(tile_scrub)
        below_tiles.append(tile_below)

    log.info(f"Merging {len(scrub_tiles)} scrub-count tiles …")
    _merge_raster_tiles(scrub_tiles, out_scrub_count)
    log.info(f"Merging {len(below_tiles)} below-count tiles …")
    _merge_raster_tiles(below_tiles, out_below_count)

    for p in scrub_tiles + below_tiles:
        os.remove(p)


def fill_nodata(src_path: str, dst_path: str, max_distance: int = 100):
    """Fill nodata holes (e.g. under dense canopy, water, LAZ-tile seams) using GDAL.

    Default search distance is 100 pixels (= 100 m at 1 m DTM resolution), enough to
    bridge typical canopy gaps and river ribbons without smearing detail across true
    edge boundaries — fill_nodata only interpolates from valid pixels surrounding a
    hole, so it cannot extend the data outward beyond the original footprint.
    """
    log.info(f"Filling nodata in {os.path.basename(src_path)} …")
    ds = gdal.Open(src_path)
    driver = gdal.GetDriverByName("GTiff")
    out_ds = driver.CreateCopy(dst_path, ds, options=["COMPRESS=LZW"])
    band = out_ds.GetRasterBand(1)
    gdal.FillNodata(band, maskBand=None, maxSearchDist=max_distance, smoothingIterations=2)
    out_ds.FlushCache()
    out_ds = None
    ds = None


def _binary_close(mask: np.ndarray, radius: int = 5) -> np.ndarray:
    """Morphological close on a 0/1 uint8 mask: dilate then erode by `radius` cells.

    Hand-rolled with a separable square structuring element so we don't pull in
    scipy. For each pass (dilate, erode), shifts the mask by 1 cell in each of
    the 4 cardinal directions `radius` times. Bridges nodata gaps narrower than
    2*radius cells before polygonization.
    """
    if radius <= 0:
        return mask
    m = mask.astype(np.uint8, copy=True)
    h, w = m.shape

    def dilate_once(a):
        out = a.copy()
        out[1:, :]  |= a[:-1, :]
        out[:-1, :] |= a[1:, :]
        out[:, 1:]  |= a[:, :-1]
        out[:, :-1] |= a[:, 1:]
        return out

    def erode_once(a):
        out = a.copy()
        out[1:, :]  &= a[:-1, :]
        out[:-1, :] &= a[1:, :]
        out[:, 1:]  &= a[:, :-1]
        out[:, :-1] &= a[:, 1:]
        return out

    for _ in range(radius):
        m = dilate_once(m)
    for _ in range(radius):
        m = erode_once(m)
    return m


def compute_data_footprint(dtm_path: str, dst_geojson_path: str):
    """Polygonize the valid-pixel mask of a DTM raster → tight WGS84 footprint GeoJSON.

    Produces a single connected outer footprint with no interior holes.
    Assumes the input DTM has already been hole-filled (fill_nodata) so the
    valid-pixel mask is close to the true data extent — this keeps the
    footprint tight against the rendered tiles instead of expanding beyond it.
    Pipeline:
      1. Build a 1 m valid-pixel binary mask.
      2. Downsample 10× for speed (~10 m effective resolution).
      3. Morphologically close the downsampled mask with a 2-cell radius
         (~20 m) so narrow residual nodata strips along LAZ-tile seams are
         bridged before polygonization, without dilating the outer edge.
      4. Polygonize, union, keep the largest connected component, take its
         exterior ring (drops any interior holes).
      5. Simplify (~50 m tolerance) and reproject to WGS84.
    """
    ds = gdal.Open(dtm_path)
    band = ds.GetRasterBand(1)
    nodata = band.GetNoDataValue()
    arr = band.ReadAsArray().astype(np.float32)

    mask_arr = np.ones((ds.RasterYSize, ds.RasterXSize), dtype=np.uint8)
    if nodata is not None:
        mask_arr[arr == float(nodata)] = 0
    mask_arr[~np.isfinite(arr)] = 0

    # Write 1m mask to memory
    mem_drv = gdal.GetDriverByName("MEM")
    mask_ds = mem_drv.Create("", ds.RasterXSize, ds.RasterYSize, 1, gdal.GDT_Byte)
    mask_ds.SetGeoTransform(ds.GetGeoTransform())
    mask_ds.SetProjection(ds.GetProjection())
    mask_ds.GetRasterBand(1).WriteArray(mask_arr)

    # Downsample 10× for faster polygonization (~10 m resolution is plenty)
    scale = 10
    new_x = max(1, ds.RasterXSize // scale)
    new_y = max(1, ds.RasterYSize // scale)
    gt = ds.GetGeoTransform()
    small_ds = mem_drv.Create("", new_x, new_y, 1, gdal.GDT_Byte)
    small_ds.SetGeoTransform((gt[0], gt[1] * scale, 0, gt[3], 0, gt[5] * scale))
    small_ds.SetProjection(ds.GetProjection())
    gdal.Warp(small_ds, mask_ds, resampleAlg=gdal.GRA_NearestNeighbour)

    # Morphological close on the downsampled mask: dilate then erode with a
    # 2-cell (~20 m) radius. Bridges narrow residual nodata strips without
    # noticeably dilating the outer edge of the data.
    small_arr = small_ds.GetRasterBand(1).ReadAsArray()
    closed_arr = _binary_close(small_arr, radius=2)
    small_ds.GetRasterBand(1).WriteArray(closed_arr)

    # Polygonize
    tmp_path = dst_geojson_path + "_tmp.geojson"
    drv = ogr.GetDriverByName("GeoJSON")
    if os.path.exists(tmp_path):
        drv.DeleteDataSource(tmp_path)
    poly_ds = drv.CreateDataSource(tmp_path)
    src_srs = osr.SpatialReference()
    src_srs.ImportFromWkt(ds.GetProjection())
    poly_layer = poly_ds.CreateLayer("footprint", srs=src_srs, geom_type=ogr.wkbPolygon)
    poly_layer.CreateField(ogr.FieldDefn("val", ogr.OFTInteger))
    gdal.Polygonize(small_ds.GetRasterBand(1), None, poly_layer, 0)
    poly_ds.FlushCache()
    poly_ds = None
    small_ds = None
    mask_ds = None

    # Union value==1 polygons, take outer boundary only
    in_ds = ogr.Open(tmp_path)
    in_layer = in_ds.GetLayer()
    polys = []
    for feat in in_layer:
        if feat.GetField("val") == 1:
            geom = feat.GetGeometryRef()
            if geom:
                polys.append(shape(json.loads(geom.ExportToJson())))
    in_ds = None

    if not polys:
        log.warning("No valid pixels found — falling back to full raster bbox for footprint")
        xmin = gt[0]; xmax = gt[0] + gt[1] * ds.RasterXSize
        ymax = gt[3]; ymin = gt[3] + gt[5] * ds.RasterYSize
        footprint_merc = shapely_box(xmin, ymin, xmax, ymax)
    else:
        merged = unary_union(polys)
        # Keep only the largest connected component — outliers from stray
        # tiles or noise pixels shouldn't shape the footprint.
        if merged.geom_type == "MultiPolygon":
            merged = max(merged.geoms, key=lambda g: g.area)
        # Drop any residual interior rings by rebuilding from the exterior ring.
        if merged.geom_type == "Polygon":
            footprint_merc = Polygon(merged.exterior)
        else:
            # Defensive: union may rarely return a non-Polygon (e.g. empty)
            xmin = gt[0]; xmax = gt[0] + gt[1] * ds.RasterXSize
            ymax = gt[3]; ymin = gt[3] + gt[5] * ds.RasterYSize
            footprint_merc = shapely_box(xmin, ymin, xmax, ymax)

    # Simplify with ~50 m tolerance (Web Mercator metres)
    footprint_merc = footprint_merc.simplify(50.0, preserve_topology=True)

    # Reproject to WGS84 via OGR
    tgt_srs = osr.SpatialReference()
    tgt_srs.ImportFromEPSG(WGS84_EPSG)
    src_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    tgt_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    transform = osr.CoordinateTransformation(src_srs, tgt_srs)
    ds = None

    geom_ogr = ogr.CreateGeometryFromJson(json.dumps(mapping(footprint_merc)))
    geom_ogr.Transform(transform)
    footprint_wgs84 = shape(json.loads(geom_ogr.ExportToJson()))

    with open(dst_geojson_path, "w") as f:
        json.dump({"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": mapping(footprint_wgs84), "properties": {}}
        ]}, f)

    try:
        os.remove(tmp_path)
    except OSError:
        pass
    log.info(f"Data footprint computed → {dst_geojson_path}")


def clip_geojson_to_footprint(geojson_path: str, footprint_path: str, out_path: str):
    """Clip GeoJSON features to footprint, dropping features entirely outside it."""
    with open(footprint_path) as f:
        fp_fc = json.load(f)
    fp_geom = unary_union([shape(feat["geometry"]) for feat in fp_fc["features"]])

    with open(geojson_path) as f:
        gj = json.load(f)

    clipped = []
    for feat in gj.get("features", []):
        geom = shape(feat["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        if not fp_geom.intersects(geom):
            continue
        if fp_geom.contains(geom):
            clipped.append(feat)
        else:
            inter = fp_geom.intersection(geom)
            if not inter.is_empty:
                clipped.append({**feat, "geometry": mapping(inter)})

    with open(out_path, "w") as f:
        json.dump({"type": "FeatureCollection", "features": clipped}, f)
    log.info(f"Clipped {len(gj.get('features', []))} → {len(clipped)} features to footprint")


def align_raster_to_reference(src_path: str, ref_path: str, dst_path: str):
    """
    Warp src_path to exactly match the projection, extent, and pixel grid
    of ref_path, writing the result to dst_path.

    This is required when the DTM and DSM come from different sources
    (e.g. Mode B: pre-built DEM for DTM, PDAL output for DSM) and may
    have different CRS, resolution, or pixel alignment.
    """
    ref_ds = gdal.Open(ref_path)
    gt = ref_ds.GetGeoTransform()
    proj = ref_ds.GetProjection()
    cols = ref_ds.RasterXSize
    rows = ref_ds.RasterYSize

    # Compute exact bounding box from reference geotransform
    xmin = gt[0]
    xmax = gt[0] + gt[1] * cols
    ymax = gt[3]
    ymin = gt[3] + gt[5] * rows  # gt[5] is negative

    gdal.Warp(
        dst_path,
        src_path,
        dstSRS=proj,
        outputBounds=(xmin, ymin, xmax, ymax),
        width=cols,
        height=rows,
        resampleAlg="bilinear",
        dstNodata=-9999,
        creationOptions=["COMPRESS=LZW"],
    )
    ref_ds = None


def _box_sum_2d(arr: np.ndarray, k: int) -> np.ndarray:
    """Sum of values in a k×k window centred on each cell, computed in O(N) via a
    summed-area table. Edge cells are reflected so the window is always full size.
    Returns a float32 array with the same shape as `arr`.
    """
    if k % 2 != 1:
        raise ValueError("window size must be odd")
    half = k // 2
    padded = np.pad(arr.astype(np.float32, copy=False), half, mode="reflect")
    # Summed-area table with a leading zero row/col for clean indexing.
    sat = np.zeros((padded.shape[0] + 1, padded.shape[1] + 1), dtype=np.float64)
    sat[1:, 1:] = padded.cumsum(axis=0).cumsum(axis=1)
    h, w = arr.shape
    # Window [i:i+k, j:j+k] over `padded` corresponds to (i, j) in the original.
    bottom_right = sat[k:k + h, k:k + w]
    top_right    = sat[0:h,     k:k + w]
    bottom_left  = sat[k:k + h, 0:w]
    top_left     = sat[0:h,     0:w]
    return (bottom_right - top_right - bottom_left + top_left).astype(np.float32)


def _build_svtm_mu_lookup() -> np.ndarray:
    """Build formation→μ lookup as a uint8-indexed float32 array from SVTM_FORMATION_MU.

    The formation raster pixel values are indices into the ordered formation
    list produced by build_svtm_formation.py, which always starts with
    "Not classified" at index 0 and adds formations in iteration order of
    SVTM_FORMATION_MU. The lookup is 256 elements so any uint8 raster value
    (including nodata=255) is a valid direct index — out-of-range values
    default to μ=1.0 (identity).
    """
    mu_lookup = np.ones(256, dtype=np.float32)
    for idx, mu in enumerate(SVTM_FORMATION_MU.values()):
        mu_lookup[idx] = mu
    # Index 255 = nodata sentinel → identity.
    mu_lookup[255] = 1.0
    return mu_lookup


def apply_svtm_weighting(density_arr: np.ndarray, dtm_path: str, work_dir: str) -> np.ndarray:
    """Multiply NRD per-pixel by the SVTM formation μ.

    The formation raster is warped from S3 (/vsis3/ path) onto the DTM grid
    (1 m, Web Mercator, nearest-neighbour to preserve discrete formation
    indices) — GDAL only fetches the tiles covering the job AOI, so the full
    NSW-wide raster never loads into memory. μ is then looked up per cell.

    Returns the input array unchanged if SVTM_FORMATION_S3_PATH is unset or
    empty, or if the /vsis3/ path cannot be opened (e.g. offline dev without
    LocalStack) — the pipeline always degrades cleanly.

    Output is clamped to [0, 1] so MAX_RATIO normalisation downstream is
    still meaningful (μ > 1 can push NRD beyond 1).
    """
    if not SVTM_FORMATION_RASTER:
        log.info("SVTM_FORMATION_S3_PATH not set — skipping vegetation weighting.")
        return density_arr

    log.info(f"Warping SVTM formation raster onto DTM grid (source: {SVTM_FORMATION_RASTER}) …")
    formation_aligned = os.path.join(work_dir, "svtm_formation_aligned.tif")

    try:
        ref_ds = gdal.Open(dtm_path)
        gt = ref_ds.GetGeoTransform()
        proj = ref_ds.GetProjection()
        cols = ref_ds.RasterXSize
        rows = ref_ds.RasterYSize
        xmin = gt[0]
        xmax = gt[0] + gt[1] * cols
        ymax = gt[3]
        ymin = gt[3] + gt[5] * rows
        gdal.Warp(
            formation_aligned,
            SVTM_FORMATION_RASTER,
            dstSRS=proj,
            outputBounds=(xmin, ymin, xmax, ymax),
            width=cols,
            height=rows,
            resampleAlg="near",
            dstNodata=255,
            outputType=gdal.GDT_Byte,
            creationOptions=["COMPRESS=LZW", "TILED=YES"],
        )
        ref_ds = None
    except Exception as e:
        log.warning(f"SVTM formation raster unavailable ({e}) — skipping vegetation weighting.")
        return density_arr

    mu_lookup = _build_svtm_mu_lookup()
    form_ds = gdal.Open(formation_aligned)
    formation_arr = form_ds.GetRasterBand(1).ReadAsArray().astype(np.uint8)
    form_ds = None

    mu = mu_lookup[formation_arr]
    weighted = density_arr * mu
    # Preserve NaN nodata cells; clamp valid weighted values to [0, 1].
    out = np.where(np.isfinite(density_arr), np.clip(weighted, 0.0, 1.0), np.nan).astype(np.float32)
    return out


def _bilateral_filter_weighted(
    value_arr: np.ndarray,
    confidence_arr: np.ndarray,
    window: int,
    sigma_spatial: float,
    sigma_range: float,
) -> np.ndarray:
    """Confidence-weighted bilateral filter on a 2-D float raster.

    For each pixel p, computes a weighted average over the window centred at p:
        out[p] = Σ_q  w_spatial(p,q) · w_range(value[p], value[q]) · conf[q] · value[q]
                 ─────────────────────────────────────────────────────────────────────
                 Σ_q  w_spatial(p,q) · w_range(value[p], value[q]) · conf[q]

    The `conf` term lets cells with more LiDAR pulses contribute proportionally
    more — so low-pulse cells (under heavy canopy) are smoothed *into* by
    surrounding high-pulse cells rather than dominating the average.

    Vectorised: for each offset (dy, dx) in the window we shift the arrays and
    accumulate. O(N · window²) numpy ops; ~10–30 s on a 10k×10k raster.
    """
    if window % 2 != 1:
        raise ValueError("window size must be odd")
    half = window // 2

    # Pad with `reflect` so border pixels still see a full window's worth of
    # neighbours (avoids edge artifacts at the raster boundary).
    val_p = np.pad(value_arr,      half, mode="reflect")
    cnf_p = np.pad(confidence_arr, half, mode="reflect")

    h, w = value_arr.shape
    num   = np.zeros((h, w), dtype=np.float64)
    denom = np.zeros((h, w), dtype=np.float64)

    inv_2_s2 = 1.0 / (2.0 * sigma_spatial * sigma_spatial)
    inv_2_r2 = 1.0 / (2.0 * sigma_range   * sigma_range)

    for dy in range(-half, half + 1):
        for dx in range(-half, half + 1):
            spatial_w = math.exp(-(dy * dy + dx * dx) * inv_2_s2)
            if spatial_w < 1e-4:
                continue
            v_shift = val_p[half + dy : half + dy + h, half + dx : half + dx + w]
            c_shift = cnf_p[half + dy : half + dy + h, half + dx : half + dx + w]
            diff = value_arr - v_shift
            range_w = np.exp(-(diff * diff) * inv_2_r2)
            w_combined = spatial_w * range_w * c_shift
            num   += w_combined * v_shift
            denom += w_combined

    out = np.zeros_like(value_arr, dtype=np.float32)
    valid = denom > 0
    out[valid] = (num[valid] / denom[valid]).astype(np.float32)
    out[~valid] = np.nan
    return out


def compute_rasters(dtm_path: str, scrub_count_path: str, below_count_path: str,
                    work_dir: str) -> dict:
    """
    From DTM + NRD-count rasters produce hillshade.tif, slope.tif, scrub_density.tif.

    The count rasters are first warped onto the DTM pixel grid so array shapes
    are guaranteed to match — essential in Mode B where the DTM comes from a
    pre-built DEM and the counts come from PDAL.

    Scrub density is computed as Normalized Relative Density (NRD):
        NRD = scrub_count / (scrub_count + below_count)
    where the denominator counts every pulse that reached ≤ 2.0 m HAG (scrub
    band plus everything below it, ground returns included). This compensates
    for canopy occlusion at the source — a heavy overstory absorbs most pulses,
    but the few that make it through still normalize the scrub-band count
    rather than producing a wild ratio off a tiny denominator.

    A confidence-weighted bilateral filter is then applied, where the per-cell
    confidence is the total pulse count (scrub + below). This preserves sharp
    edges between scrub patches while smoothing the speckle in low-confidence
    interior pixels.
    """
    paths = {}

    # Hillshade from DTM
    hs_path = os.path.join(work_dir, "hillshade.tif")
    log.info("Computing hillshade …")
    gdal.DEMProcessing(
        hs_path, dtm_path, "hillshade",
        azimuth=315, altitude=45, zFactor=1.5,
        creationOptions=["COMPRESS=LZW"],
    )
    paths["hillshade"] = hs_path

    # Slope from DTM
    sl_path = os.path.join(work_dir, "slope.tif")
    log.info("Computing slope …")
    gdal.DEMProcessing(
        sl_path, dtm_path, "slope",
        slopeFormat="degree",
        creationOptions=["COMPRESS=LZW"],
    )
    paths["slope"] = sl_path

    # Scrub density: NRD + count-weighted bilateral filter.
    # Step 1: align count rasters onto the DTM grid
    scrub_aligned = os.path.join(work_dir, "scrub_count_aligned.tif")
    below_aligned = os.path.join(work_dir, "below_count_aligned.tif")
    log.info("Aligning count rasters to DTM grid …")
    align_raster_to_reference(scrub_count_path, dtm_path, scrub_aligned)
    align_raster_to_reference(below_count_path, dtm_path, below_aligned)

    log.info(
        f"Computing NRD + bilateral filter "
        f"({SCRUB_DENSITY_FILTER_WINDOW_M}×{SCRUB_DENSITY_FILTER_WINDOW_M} m, "
        f"σ_s={SCRUB_DENSITY_SIGMA_SPATIAL_M} m, σ_r={SCRUB_DENSITY_SIGMA_RANGE}) …"
    )
    dtm_ds   = gdal.Open(dtm_path)
    scrub_ds = gdal.Open(scrub_aligned)
    below_ds = gdal.Open(below_aligned)

    # PDAL writes count rasters with nodata=0; warp then injects -9999 sentinels
    # at non-overlap edges. For NRD purposes "no points" is a count of 0, not
    # nodata — clamp anything non-positive (sentinel or NaN) to zero so it
    # cleanly contributes nothing without poisoning the arithmetic.
    def _read_count(ds):
        a = ds.GetRasterBand(1).ReadAsArray().astype(np.float32)
        a[~np.isfinite(a)] = 0.0
        a[a < 0] = 0.0
        return a

    scrub_arr = _read_count(scrub_ds)
    below_arr = _read_count(below_ds)
    total_arr = scrub_arr + below_arr

    # Per-cell raw NRD; cells with zero total contribute 0 (smoothed away by
    # the bilateral filter via their zero confidence weight).
    raw_nrd = np.where(total_arr > 0, scrub_arr / np.maximum(total_arr, 1.0), 0.0).astype(np.float32)

    # Bilateral filter, weighted by per-cell pulse count.
    nrd_smoothed = _bilateral_filter_weighted(
        raw_nrd,
        total_arr,
        window=SCRUB_DENSITY_FILTER_WINDOW_M,
        sigma_spatial=SCRUB_DENSITY_SIGMA_SPATIAL_M,
        sigma_range=SCRUB_DENSITY_SIGMA_RANGE,
    )

    # Mask cells whose windowed pulse sum is below the confidence threshold —
    # a box sum is faster than re-walking the bilateral neighbourhood and is
    # exactly the right quantity for "are there enough total pulses nearby?".
    windowed_pulses = _box_sum_2d(total_arr, SCRUB_DENSITY_FILTER_WINDOW_M)
    valid = (windowed_pulses >= SCRUB_DENSITY_MIN_PULSES) & np.isfinite(nrd_smoothed)
    density = np.where(valid, nrd_smoothed, np.nan).astype(np.float32)

    # Apply SVTM formation μ — distinguishes soft (rainforest) from hard
    # (sclerophyll/heath) vegetation of equal LiDAR density. No-op if the
    # preprocessed formation raster is absent.
    density = apply_svtm_weighting(density, dtm_path, work_dir)

    # Write scrub_density.tif (values 0–1, nodata = -9999)
    density_path = os.path.join(work_dir, "scrub_density.tif")
    density_out = np.where(np.isfinite(density), density, -9999).astype(np.float32)
    driver = gdal.GetDriverByName("GTiff")
    out_ds = driver.Create(
        density_path,
        dtm_ds.RasterXSize,
        dtm_ds.RasterYSize,
        1,
        gdal.GDT_Float32,
        options=["COMPRESS=LZW"],
    )
    out_ds.SetGeoTransform(dtm_ds.GetGeoTransform())
    out_ds.SetProjection(dtm_ds.GetProjection())
    band = out_ds.GetRasterBand(1)
    band.WriteArray(density_out)
    band.SetNoDataValue(-9999)
    out_ds.FlushCache()
    out_ds = None
    paths["scrub_density"] = density_path
    return paths


def compute_rasters_no_veg(dtm_path: str, work_dir: str) -> dict:
    """Compute only hillshade and slope (no DSM/CHM available). Mode A."""
    paths = {}

    hs_path = os.path.join(work_dir, "hillshade.tif")
    log.info("Computing hillshade …")
    gdal.DEMProcessing(
        hs_path, dtm_path, "hillshade",
        azimuth=315, altitude=45, zFactor=1.5,
        creationOptions=["COMPRESS=LZW"],
    )
    paths["hillshade"] = hs_path

    sl_path = os.path.join(work_dir, "slope.tif")
    log.info("Computing slope …")
    gdal.DEMProcessing(
        sl_path, dtm_path, "slope",
        slopeFormat="degree",
        creationOptions=["COMPRESS=LZW"],
    )
    paths["slope"] = sl_path
    return paths

# ---------------------------------------------------------------------------
# Step 3 – Fetch OSM features
# ---------------------------------------------------------------------------

def fetch_osm_features(lon_min: float, lat_min: float, lon_max: float, lat_max: float,
                       work_dir: str, footprint_path: Optional[str] = None) -> Optional[str]:
    """Download OSM data via Overpass API, then clip to the data footprint. Returns path to GeoJSON."""
    log.info("Fetching OSM features from Overpass API …")
    bbox = f"{lat_min},{lon_min},{lat_max},{lon_max}"

    parts = []
    for tag_filter in OSM_FEATURE_QUERIES.values():
        parts.append(f'nwr{tag_filter}({bbox});')

    query = f"""
    [out:json][timeout:120];
    (
      {''.join(parts)}
    );
    out body geom;
    """

    # Multiple Overpass mirrors — the main endpoint has been returning 406
    # for requests coming from AWS Fargate egress IPs. Rotate across mirrors
    # so transient blocks on one don't kill the whole layer.
    endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
    ]
    headers = {
        "User-Agent": "LogjamTopoWorker/1.0",
        "Accept": "application/json",
    }

    import time as _time
    resp = None
    last_err: Optional[str] = None
    attempts = 0
    for endpoint in endpoints:
        for retry in range(2):
            attempts += 1
            try:
                resp = requests.post(endpoint, data={"data": query},
                                     headers=headers, timeout=180)
                resp.raise_for_status()
                break
            except Exception as e:
                last_err = f"{endpoint}: {e}"
                log.warning(f"Overpass attempt {attempts} failed ({last_err})")
                resp = None
                if retry == 0:
                    _time.sleep(10)
        if resp is not None and resp.ok:
            break
    if resp is None or not resp.ok:
        log.warning(f"Overpass API failed after {attempts} attempts across {len(endpoints)} endpoints. "
                    f"Features layer will be empty. Last error: {last_err}")
        return None

    raw = resp.json()
    geojson_path = os.path.join(work_dir, "osm_features.geojson")
    features = []

    for el in raw.get("elements", []):
        props = {**el.get("tags", {}), "_osm_type": el.get("type")}
        # Classify into our feature categories
        tags = el.get("tags", {})
        category = classify_osm_element(tags)
        if not category:
            continue
        props["_category"] = category

        geom = None
        if el["type"] == "node" and "lat" in el:
            geom = {"type": "Point", "coordinates": [el["lon"], el["lat"]]}
        elif el["type"] == "way" and "geometry" in el:
            coords = [[p["lon"], p["lat"]] for p in el["geometry"]]
            if len(coords) >= 2:
                if coords[0] == coords[-1] and len(coords) >= 4:
                    geom = {"type": "Polygon", "coordinates": [coords]}
                else:
                    geom = {"type": "LineString", "coordinates": coords}
        elif el["type"] == "relation" and "members" in el:
            # Simplified: just take the outer way if available
            for m in el.get("members", []):
                if m.get("role") == "outer" and "geometry" in m:
                    coords = [[p["lon"], p["lat"]] for p in m["geometry"]]
                    if len(coords) >= 4:
                        geom = {"type": "Polygon", "coordinates": [coords]}
                    break

        if geom:
            features.append({"type": "Feature", "geometry": geom, "properties": props})

    geojson = {"type": "FeatureCollection", "features": features}
    with open(geojson_path, "w") as f:
        json.dump(geojson, f)
    log.info(f"OSM fetch complete: {len(features)} features.")

    if footprint_path and os.path.exists(footprint_path):
        clipped_path = os.path.join(work_dir, "osm_features.geojson")
        clip_geojson_to_footprint(geojson_path, footprint_path, clipped_path)
        return clipped_path

    return geojson_path


def classify_osm_element(tags: dict) -> Optional[str]:
    hw = tags.get("highway", "")
    ww = tags.get("waterway", "")
    nat = tags.get("natural", "")
    tour = tags.get("tourism", "")
    pw = tags.get("power", "")
    bar = tags.get("barrier", "")

    if ww in ("river", "stream", "creek", "drain", "canal", "ditch"):
        return "waterway"
    if hw in ("track", "path", "footway", "bridleway", "steps"):
        return "track"
    if hw in ("primary", "secondary", "tertiary", "unclassified", "residential", "service"):
        return "road"
    if "building" in tags:
        return "building"
    if pw in ("line", "minor_line", "cable"):
        return "power"
    if tour in ("camp_site", "caravan_site", "wilderness_hut", "alpine_hut"):
        return "campsite"
    if nat in ("peak", "saddle", "cliff", "ridge", "volcano"):
        return "peak"
    if nat in ("spring", "water", "wetland"):
        return "spring"
    if bar in ("gate", "lift_gate", "cycle_barrier"):
        return "gate"
    if tour == "viewpoint":
        return "viewpoint"
    if nat == "cave_entrance":
        return "cave"
    if tour == "picnic_site":
        return "picnic"
    return None

# ---------------------------------------------------------------------------
# Step 4 – Contour generation
# ---------------------------------------------------------------------------

def generate_contours(dtm_path: str, work_dir: str) -> dict:
    """Generate GeoJSON contour files for each interval."""
    log.info("Generating contours …")
    paths = {}
    for intervals_needed in [5, 10, 50]:
        out_path = os.path.join(work_dir, f"contours_{intervals_needed}m.geojson")
        ds = gdal.ContourGenerate(
            gdal.Open(dtm_path).GetRasterBand(1),
            intervals_needed,  # interval
            0,                 # base
            [],                # fixed levels
            0, 0,              # nodata flag/value
            ogr.GetDriverByName("GeoJSON").CreateDataSource(out_path)
                .CreateLayer("contours", srs=_merc_srs(), geom_type=ogr.wkbLineString),
            -1,                # id field
            0,                 # elev field index
        )
        paths[intervals_needed] = out_path
        log.info(f"  {intervals_needed}m contours → {out_path}")
    return paths


def _merc_srs():
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(WEB_MERCATOR_EPSG)
    return srs


def generate_contours_gdal(dtm_filled: str, work_dir: str,
                           footprint_path: Optional[str] = None) -> dict:
    """
    Generate contour GeoJSONs from the DTM.

    gdal_contour outputs coordinates in the DTM's CRS (Web Mercator).
    We then reproject each GeoJSON to WGS84 (EPSG:4326) and clip to the
    data footprint so contours don't extend into nodata-filled edges.
    """
    paths = {}
    for interval in [5, 10, 50]:
        merc_path = os.path.join(work_dir, f"contours_{interval}m_merc.geojson")
        reproj_path = os.path.join(work_dir, f"contours_{interval}m_reproj.geojson")
        out_path  = os.path.join(work_dir, f"contours_{interval}m.geojson")

        # Step 1: generate contours in Web Mercator
        cmd = [
            "gdal_contour",
            "-a", "elev",
            "-i", str(interval),
            "-f", "GeoJSON",
            dtm_filled,
            merc_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"gdal_contour failed:\n{result.stderr}")

        # Step 2: reproject to WGS84
        cmd2 = [
            "ogr2ogr",
            "-f", "GeoJSON",
            "-t_srs", "EPSG:4326",
            reproj_path,
            merc_path,
        ]
        result2 = subprocess.run(cmd2, capture_output=True, text=True)
        if result2.returncode != 0:
            raise RuntimeError(f"ogr2ogr reproject failed:\n{result2.stderr}")

        # Step 3: clip to data footprint if available
        if footprint_path and os.path.exists(footprint_path):
            clip_geojson_to_footprint(reproj_path, footprint_path, out_path)
        else:
            os.rename(reproj_path, out_path)

        paths[interval] = out_path
        log.info(f"  {interval}m contours → {out_path}")

    log.info("Contour generation complete.")
    return paths

# ---------------------------------------------------------------------------
# Step 5 – Tile rendering helpers
# ---------------------------------------------------------------------------

def read_raster_window(raster_path: str, bbox_merc: Tuple, out_size: int = TILE_SIZE) -> Optional[np.ndarray]:
    """
    Read a window from a raster into a numpy array of shape (out_size, out_size).
    Returns None if the tile is entirely outside the raster extent.
    """
    ds = gdal.Open(raster_path)
    if ds is None:
        return None
    gt = ds.GetGeoTransform()   # (xmin, px_w, 0, ymax, 0, -px_h)
    xmin_r = gt[0]
    xmax_r = gt[0] + gt[1] * ds.RasterXSize
    ymax_r = gt[3]
    ymin_r = gt[3] + gt[5] * ds.RasterYSize

    xmin_t, ymin_t, xmax_t, ymax_t = bbox_merc
    # Check overlap
    if xmax_t < xmin_r or xmin_t > xmax_r or ymax_t < ymin_r or ymin_t > ymax_r:
        return None

    # Use gdal.Warp to reproject/resample into a memory array
    mem_drv = gdal.GetDriverByName("MEM")
    dst = mem_drv.Create("", out_size, out_size, 1, gdal.GDT_Float32)
    dst.SetProjection(ds.GetProjection())
    tile_res_x = (xmax_t - xmin_t) / out_size
    tile_res_y = (ymax_t - ymin_t) / out_size
    dst.SetGeoTransform((xmin_t, tile_res_x, 0, ymax_t, 0, -tile_res_y))

    gdal.Warp(dst, ds, resampleAlg=gdal.GRA_Bilinear)
    arr = dst.GetRasterBand(1).ReadAsArray().astype(np.float32)
    nodata = ds.GetRasterBand(1).GetNoDataValue()
    if nodata is not None:
        arr[arr == nodata] = np.nan
    return arr

# ---------------------------------------------------------------------------
# Per-layer tile renderers
# ---------------------------------------------------------------------------

_geojson_cache: Dict[str, dict] = {}
_footprint_shape_cache: Dict[str, object] = {}

def _load_geojson(path: str) -> dict:
    """Load and cache parsed GeoJSON. Each ProcessPoolExecutor worker gets its
    own copy of the module, so the cache is per-process — the file is parsed
    once per worker rather than once per tile."""
    if path not in _geojson_cache:
        with open(path) as f:
            _geojson_cache[path] = json.load(f)
    return _geojson_cache[path]


def _load_footprint_shape(footprint_path: str):
    """Load and cache footprint as a shapely geometry (per-process cache)."""
    if footprint_path not in _footprint_shape_cache:
        gj = _load_geojson(footprint_path)
        _footprint_shape_cache[footprint_path] = unary_union(
            [shape(f["geometry"]) for f in gj["features"]]
        )
    return _footprint_shape_cache[footprint_path]


def _apply_footprint_mask(img: Image.Image, footprint_path: str,
                          bbox_wgs84: Tuple) -> Image.Image:
    """Zero alpha where the footprint polygon is absent.

    Tiles entirely inside the footprint are returned unchanged.
    Tiles partially intersecting the footprint have their alpha channel
    masked so only pixels inside the footprint remain visible.
    Tiles entirely outside are returned fully transparent.
    """
    lon_min, lat_min, lon_max, lat_max = bbox_wgs84
    tile_box = shapely_box(lon_min, lat_min, lon_max, lat_max)
    fp_geom = _load_footprint_shape(footprint_path)

    if fp_geom.contains(tile_box):
        return img
    if not fp_geom.intersects(tile_box):
        return Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))

    # Partial overlap: rasterize intersection into a 256×256 mask
    inter = fp_geom.intersection(tile_box)
    mask_img = Image.new("L", (TILE_SIZE, TILE_SIZE), 0)
    draw = ImageDraw.Draw(mask_img)
    tile_w = lon_max - lon_min
    tile_h = lat_max - lat_min

    def to_px(lon, lat):
        return ((lon - lon_min) / tile_w * TILE_SIZE,
                (lat_max - lat) / tile_h * TILE_SIZE)

    def rasterize_poly(poly):
        pts = [to_px(c[0], c[1]) for c in poly.exterior.coords]
        if len(pts) >= 3:
            draw.polygon(pts, fill=255)

    if inter.geom_type == "Polygon":
        rasterize_poly(inter)
    elif inter.geom_type in ("MultiPolygon", "GeometryCollection"):
        for g in inter.geoms:
            if g.geom_type == "Polygon":
                rasterize_poly(g)

    r, g, b, a = img.split()
    new_a = Image.fromarray(
        np.minimum(np.array(a), np.array(mask_img)).astype(np.uint8), mode="L"
    )
    return Image.merge("RGBA", (r, g, b, new_a))


def render_hillshade_tile(hs_arr: Optional[np.ndarray]) -> Image.Image:
    img = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    if hs_arr is None:
        return img
    valid = np.isfinite(hs_arr)
    if not valid.any():
        return img
    norm = np.clip(hs_arr, 0, 255)
    # Desaturate + fade for "faint greyscale" effect
    alpha_val = 255
    rgba = np.zeros((TILE_SIZE, TILE_SIZE, 4), dtype=np.uint8)
    safe = np.nan_to_num(norm, nan=0).astype(np.uint8)
    rgba[..., 0] = safe
    rgba[..., 1] = safe
    rgba[..., 2] = safe
    rgba[..., 3] = np.where(valid, alpha_val, 0).astype(np.uint8)
    return Image.fromarray(rgba)


def render_vegetation_tile(density_arr: Optional[np.ndarray]) -> Image.Image:
    """Render scrub density (0–1 ratio) as a light→dark green overlay.

    density_arr contains the normalised point ratio (scrub-band returns / total
    returns per cell). Values below SCRUB_DENSITY_MIN_RATIO are transparent.
    A sqrt curve spreads low-density values for better perceptual differentiation.
    """
    img = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    if density_arr is None:
        return img

    mask = np.isfinite(density_arr) & (density_arr >= SCRUB_DENSITY_MIN_RATIO)
    if not mask.any():
        return img

    # Map [MIN_RATIO, MAX_RATIO] → [0, 1] then apply sqrt for perceptual spread
    t = np.sqrt(np.clip(
        (density_arr - SCRUB_DENSITY_MIN_RATIO) / (SCRUB_DENSITY_MAX_RATIO - SCRUB_DENSITY_MIN_RATIO),
        0, 1,
    ))

    rgba = np.zeros((TILE_SIZE, TILE_SIZE, 4), dtype=np.uint8)
    # Colour gradient: sparse = light green (144,238,144), dense = dark green (0,100,0)
    rgba[..., 0] = np.where(mask, (144 - t * 144).astype(np.uint8), 0)
    rgba[..., 1] = np.where(mask, (238 - t * 138).astype(np.uint8), 0)
    rgba[..., 2] = np.where(mask, (144 - t * 144).astype(np.uint8), 0)
    rgba[..., 3] = np.where(mask, (60  + t * 195).astype(np.uint8), 0)
    return Image.fromarray(rgba)


def render_slope_tile(slope_arr: Optional[np.ndarray]) -> Image.Image:
    img = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    if slope_arr is None:
        return img
    rgba = np.zeros((TILE_SIZE, TILE_SIZE, 4), dtype=np.uint8)
    for lo, hi, colour in SLOPE_COLOURS:
        m = np.isfinite(slope_arr) & (slope_arr >= lo) & (slope_arr < hi)
        rgba[m] = colour
    return Image.fromarray(rgba)


def render_features_tile(geojson_path: Optional[str], bbox_wgs84: Tuple, zoom: int) -> Image.Image:
    img = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    if not geojson_path or not os.path.exists(geojson_path):
        return img

    lon_min, lat_min, lon_max, lat_max = bbox_wgs84
    scale = ground_metres_per_pixel(zoom)

    try:
        gj = _load_geojson(geojson_path)
    except Exception:
        return img

    draw = ImageDraw.Draw(img)

    def lonlat_to_px(lon, lat):
        px = (lon - lon_min) / (lon_max - lon_min) * TILE_SIZE
        py = (lat_max - lat) / (lat_max - lat_min) * TILE_SIZE
        return px, py

    for feat in gj.get("features", []):
        cat = feat.get("properties", {}).get("_category")
        style = OSM_STYLES.get(cat)
        if not style:
            continue

        geom = feat.get("geometry", {})
        gtype = geom.get("type")

        if style.get("point") and gtype == "Point":
            lon, lat = geom["coordinates"]
            if lon_min <= lon <= lon_max and lat_min <= lat <= lat_max:
                px, py = lonlat_to_px(lon, lat)
                sym = style.get("symbol", "●")
                sz = max(6, int(style.get("size_z18", 12) * (zoom / 18) ** 0.5))
                try:
                    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", sz)
                except Exception:
                    font = ImageFont.load_default()
                draw.text((px - sz // 2, py - sz // 2), sym, fill=style["colour"], font=font)

        elif gtype == "LineString":
            coords = geom.get("coordinates", [])
            # Keep full line if any vertex is in/near tile (same fix as contours)
            pad = 0.005
            touches = any(
                lon_min - pad <= c[0] <= lon_max + pad and
                lat_min - pad <= c[1] <= lat_max + pad
                for c in coords
            )
            if not touches:
                continue
            pts = [lonlat_to_px(c[0], c[1]) for c in coords]
            if len(pts) >= 2:
                w = max(1, int(style.get("width_z18", 2) * zoom / 18))
                draw.line(pts, fill=style["colour"], width=w)

                # Labels for waterways, tracks, roads (only at z14+)
                label_cats = {"waterway", "track", "road"}
                if zoom >= 14 and cat in label_cats:
                    tags = feat.get("properties", {})
                    label = tags.get("name") or tags.get("ref")
                    if label:
                        label_size = max(7, int(10 * zoom / 18))
                        try:
                            lbl_font = ImageFont.truetype(
                                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", label_size)
                        except Exception:
                            lbl_font = ImageFont.load_default()
                        # Place label near the midpoint of the visible segment
                        visible = [
                            p for p, c in zip(pts, coords)
                            if lon_min <= c[0] <= lon_max and lat_min <= c[1] <= lat_max
                        ]
                        if len(visible) >= 2:
                            mid = visible[len(visible) // 2]
                            lbl_colour = style["colour"][:3] + (230,)
                            for dx, dy in [(-1,-1),(1,-1),(-1,1),(1,1),(0,-1),(0,1),(-1,0),(1,0)]:
                                draw.text((mid[0]+dx, mid[1]+dy), label,
                                          fill=(255,255,255,200), font=lbl_font)
                            draw.text(mid, label, fill=lbl_colour, font=lbl_font)

        elif gtype == "Polygon":
            coords = geom.get("coordinates", [[]])[0]
            pts = [lonlat_to_px(c[0], c[1]) for c in coords]
            if len(pts) >= 3:
                fill_col = style.get("fill")
                if fill_col:
                    draw.polygon(pts, fill=fill_col)
                w = max(1, int(style.get("width_z18", 2) * zoom / 18))
                draw.line(pts + [pts[0]], fill=style["colour"], width=w)

    return img


def render_contours_tile(contour_paths: dict, bbox_wgs84: Tuple, zoom: int) -> Image.Image:
    img = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    lon_min, lat_min, lon_max, lat_max = bbox_wgs84

    # Determine which interval(s) to render at this zoom
    active_interval = None
    show_5m = False
    for z_lo, z_hi, interval in CONTOUR_ZOOM_INTERVALS:
        if z_lo <= zoom <= z_hi:
            active_interval = interval
            show_5m = (interval == 5)
            break
    if active_interval is None:
        return img

    intervals_to_draw = []
    if active_interval == 5:
        intervals_to_draw = [5, 10, 50]
    elif active_interval == 10:
        intervals_to_draw = [10, 50]
    else:
        intervals_to_draw = [50]

    def lonlat_to_px(lon, lat):
        px = (lon - lon_min) / (lon_max - lon_min) * TILE_SIZE
        py = (lat_max - lat) / (lat_max - lat_min) * TILE_SIZE
        return px, py

    try:
        font_major = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                                        max(8, int(11 * zoom / 16)))
        font_minor = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                                        max(6, int(9 * zoom / 16)))
    except Exception:
        font_major = font_minor = ImageFont.load_default()

    # Draw from largest interval first (so smaller sit on top)
    for interval in sorted(intervals_to_draw, reverse=True):
        path = contour_paths.get(interval)
        if not path or not os.path.exists(path):
            continue
        try:
            gj = _load_geojson(path)
        except Exception:
            continue

        is_major = (interval == 50)
        colour = (80, 60, 40, 220) if is_major else (120, 90, 60, 160)
        line_width = max(1, int((3 if is_major else 1) * zoom / 16))

        label_interval = interval == 50 and active_interval != 50

        # Use 1 full tile-width of padding so cross-edge lines are always kept.
        # At z14 one tile ≈ 0.022° wide; at z18 ≈ 0.0014°. 0.05° covers all zooms.
        pad = 0.05
        for feat in gj.get("features", []):
            geom = feat.get("geometry", {})
            if geom.get("type") != "LineString":
                continue
            coords = geom.get("coordinates", [])
            if not coords:
                continue

            # Reject if clearly outside tile + padding
            feat_lon_min = min(c[0] for c in coords)
            feat_lon_max = max(c[0] for c in coords)
            feat_lat_min = min(c[1] for c in coords)
            feat_lat_max = max(c[1] for c in coords)
            if (feat_lon_max < lon_min - pad or feat_lon_min > lon_max + pad or
                feat_lat_max < lat_min - pad or feat_lat_min > lat_max + pad):
                continue

            pts = [lonlat_to_px(c[0], c[1]) for c in coords]
            if len(pts) < 2:
                continue
            draw.line(pts, fill=colour, width=line_width)

            if label_interval and len(pts) >= 4:
                elev = feat.get("properties", {}).get("elev")
                if elev is not None:
                    # Place label at midpoint of the portion inside the tile
                    visible_pts = [
                        p for p, c in zip(pts, coords)
                        if lon_min <= c[0] <= lon_max and lat_min <= c[1] <= lat_max
                    ]
                    if not visible_pts:
                        visible_pts = pts
                    mid = visible_pts[len(visible_pts) // 2]
                    label = f"{int(elev)}m"
                    font = font_major if is_major else font_minor
                    # White halo for legibility
                    for dx, dy in [(-1,-1),(1,-1),(-1,1),(1,1),(0,-1),(0,1),(-1,0),(1,0)]:
                        draw.text((mid[0]+dx, mid[1]+dy), label, fill=(255,255,255,200), font=font)
                    draw.text(mid, label, fill=colour, font=font)

    return img

# ---------------------------------------------------------------------------
# Step 6 – Tile generation workers
# ---------------------------------------------------------------------------

@dataclass
class RenderConfig:
    hillshade_path: str
    density_path: str
    slope_path: str
    osm_geojson: Optional[str]
    contour_paths: dict
    output_dir: str
    layers: List[str]   # which individual layers to also save
    lon_min: float
    lat_min: float
    lon_max: float
    lat_max: float
    footprint_path: Optional[str] = None


def render_tile_job(args) -> Tuple[int, int, int, dict]:
    """
    Worker function (runs in subprocess).
    Returns (z, x, y, {layer_name: png_bytes}).
    """
    z, x, y, cfg_dict = args
    cfg = RenderConfig(**cfg_dict)

    bbox_merc = tile_bbox_mercator(x, y, z)
    bbox_wgs84 = tile_to_bbox(x, y, z)

    results = {}

    # --- Hillshade ---
    hs_arr = read_raster_window(cfg.hillshade_path, bbox_merc)
    hs_img = render_hillshade_tile(hs_arr)

    # --- Vegetation ---
    density_arr = read_raster_window(cfg.density_path, bbox_merc)
    veg_img = render_vegetation_tile(density_arr)

    # --- Features ---
    feat_img = render_features_tile(cfg.osm_geojson, bbox_wgs84, z)

    # --- Slope ---
    sl_arr = read_raster_window(cfg.slope_path, bbox_merc)
    slope_img = render_slope_tile(sl_arr)

    # --- Apply footprint mask to raster layers ---
    # This ensures pixels in the nodata-filled edge ring are fully transparent.
    if cfg.footprint_path:
        try:
            hs_img = _apply_footprint_mask(hs_img, cfg.footprint_path, bbox_wgs84)
            veg_img = _apply_footprint_mask(veg_img, cfg.footprint_path, bbox_wgs84)
            slope_img = _apply_footprint_mask(slope_img, cfg.footprint_path, bbox_wgs84)
        except Exception as _e:
            log.warning(f"Footprint mask failed for tile {z}/{x}/{y}: {_e}")

    # --- Contours ---
    contour_img = render_contours_tile(cfg.contour_paths, bbox_wgs84, z)

    def img_to_png(img: Image.Image):
        """Return PNG bytes, or None if fully transparent. Uses getextrema() — no numpy needed."""
        from io import BytesIO
        # getextrema() on the alpha band: (min, max). If max==0, fully transparent.
        extrema = img.split()[3].getextrema()   # alpha channel min, max
        if extrema[1] == 0:
            return None
        buf = BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return buf.getvalue()

    layer_imgs = {
        "hillshade":  hs_img,
        "vegetation": veg_img,
        "features":   feat_img,
        "slope":      slope_img,
        "contours":   contour_img,
    }

    # Individual layers
    for lname in cfg.layers:
        png = img_to_png(layer_imgs[lname])
        if png is not None:
            results[lname] = png

    # Composite: stack bottom → top
    composite = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    active_order = ["hillshade", "vegetation", "features", "slope", "contours"]
    for lname in active_order:
        composite = Image.alpha_composite(composite, layer_imgs[lname])
    comp_png = img_to_png(composite)
    if comp_png is not None:
        results["composite"] = comp_png

    return z, x, y, results


def generate_all_tiles(cfg: RenderConfig, workers: int):
    """Iterate over all zoom levels and tiles, render in parallel, write MBTiles."""
    output_dir = cfg.output_dir
    os.makedirs(output_dir, exist_ok=True)

    layer_names = cfg.layers + ["composite"]

    # Open all MBTiles connections
    conns = {}
    for name in layer_names:
        path = os.path.join(output_dir, f"{name}.mbtiles")
        conns[name] = create_mbtiles(path, name.capitalize(), f"Topo layer: {name}")

    cfg_dict = cfg.__dict__.copy()
    jobs = []
    for z in range(ZOOM_MIN, ZOOM_MAX + 1):
        for x, y in tiles_for_bbox(cfg.lon_min, cfg.lat_min, cfg.lon_max, cfg.lat_max, z):
            jobs.append((z, x, y, cfg_dict))

    total = len(jobs)
    log.info(f"Rendering {total} tiles across zoom levels {ZOOM_MIN}–{ZOOM_MAX} "
             f"using {workers} worker(s) …")

    done = 0
    with ProcessPoolExecutor(max_workers=workers) as exe:
        futures = {exe.submit(render_tile_job, j): j for j in jobs}
        for fut in as_completed(futures):
            try:
                z, x, y, tile_data = fut.result()
                for name, png_bytes in tile_data.items():
                    insert_tile(conns[name], z, x, y, png_bytes)
                done += 1
                if done % 100 == 0 or done == total:
                    log.info(f"  Progress: {done}/{total} tiles ({100*done//total}%)")
            except Exception as e:
                log.error(f"Tile render error: {e}")

    # Commit all and write bounds
    for name, conn in conns.items():
        finalise_bounds(conn, cfg.lon_min, cfg.lat_min, cfg.lon_max, cfg.lat_max)
        conn.commit()
        conn.close()

    log.info("All tiles written.")

# ---------------------------------------------------------------------------
# Bounding box utility
# ---------------------------------------------------------------------------

def get_raster_bbox_wgs84(raster_path: str) -> Tuple[float, float, float, float]:
    ds = gdal.Open(raster_path)
    gt = ds.GetGeoTransform()
    xmin = gt[0]
    xmax = gt[0] + gt[1] * ds.RasterXSize
    ymax = gt[3]
    ymin = gt[3] + gt[5] * ds.RasterYSize

    src_srs = osr.SpatialReference()
    src_srs.ImportFromWkt(ds.GetProjection())
    tgt_srs = osr.SpatialReference()
    tgt_srs.ImportFromEPSG(WGS84_EPSG)

    # GDAL >= 3.0 respects the official CRS axis order for EPSG:4326,
    # which is (latitude, longitude) — the opposite of traditional GIS order.
    # Force (longitude, latitude) so TransformPoint returns (lon, lat, elev).
    src_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    tgt_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)

    transform = osr.CoordinateTransformation(src_srs, tgt_srs)
    lon_min, lat_min, _ = transform.TransformPoint(xmin, ymin)
    lon_max, lat_max, _ = transform.TransformPoint(xmax, ymax)

    # Guarantee min < max regardless of hemisphere / projection direction
    if lon_min > lon_max:
        lon_min, lon_max = lon_max, lon_min
    if lat_min > lat_max:
        lat_min, lat_max = lat_max, lat_min

    return lon_min, lat_min, lon_max, lat_max

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def merge_dem_tiles(dem_files: List[Path], out_path: str):
    """Mosaic multiple DEM GeoTIFFs into one and reproject to Web Mercator.

    Reads source nodata from the first DEM's band metadata and propagates it
    through the warp so the rotated edge cells become nodata instead of
    bilinear-blended attenuated values. INIT_DEST=NO_DATA stops cubic
    resampling from averaging valid + nodata at the boundary.
    """
    log.info(f"Merging {len(dem_files)} DEM tile(s) into Web Mercator …")
    vrt_path = out_path.replace(".tif", "_input.vrt")
    gdal.BuildVRT(vrt_path, [str(f) for f in dem_files])

    src_ds = gdal.Open(str(dem_files[0]))
    src_nodata = src_ds.GetRasterBand(1).GetNoDataValue()
    src_ds = None
    if src_nodata is None:
        src_nodata = -9999

    gdal.Warp(
        out_path, vrt_path,
        dstSRS=f"EPSG:{WEB_MERCATOR_EPSG}",
        resampleAlg="cubic",
        srcNodata=src_nodata,
        dstNodata=-9999,
        warpOptions=["INIT_DEST=NO_DATA"],
        creationOptions=["COMPRESS=LZW"],
    )
    log.info("DEM merge complete.")


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Convert an ELVIS LiDAR ZIP into topo MBTiles for Gaia GPS.\n\n"
            "Auto-detects ZIP contents and selects the fastest available pipeline:\n"
            "  Mode A (DEM only)  – fastest, no vegetation layer\n"
            "  Mode B (DEM + LAZ) – all layers, moderate speed\n"
            "  Mode C (LAZ only)  – all layers, slowest"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("elvis_zip", help="Path to the ELVIS ZIP file")
    parser.add_argument("--output", default="./output",
                        help="Output directory (default: ./output)")
    parser.add_argument("--workers", type=int,
                        default=max(1, multiprocessing.cpu_count() - 1),
                        help="Parallel tile-render workers (default: CPU count − 1)")
    parser.add_argument("--work-dir", default=None,
                        help="Intermediate file directory (default: auto temp dir)")
    parser.add_argument("--keep-work", action="store_true",
                        help="Keep intermediate working files after completion")
    parser.add_argument("--skip-osm", action="store_true",
                        help="Skip Overpass API download (offline / testing mode)")
    parser.add_argument("--benchmark", action="store_true",
                        help="Print per-step timing report at the end")
    parser.add_argument("--export-geojson", default=None, metavar="DIR",
                        help=(
                            "Copy intermediate GeoJSON files (contours + OSM features) "
                            "to DIR for external vector tile generation."
                        ))
    parser.add_argument("--export-footprint", default=None, metavar="DIR",
                        help=(
                            "Copy the computed data-coverage footprint GeoJSON "
                            "to DIR (alongside --export-geojson outputs)."
                        ))
    parser.add_argument("--layers", default="all",
                        help=(
                            "Comma-separated list of layers to generate "
                            "(hillshade, vegetation, features, slope, contours, composite). "
                            "Defaults to 'all'. 'composite' is always included."
                        ))
    args = parser.parse_args()

    if not os.path.exists(args.elvis_zip):
        log.error(f"File not found: {args.elvis_zip}")
        sys.exit(1)

    bench = Benchmark(enabled=args.benchmark)
    use_temp = args.work_dir is None
    work_dir = args.work_dir or tempfile.mkdtemp(prefix="topo_")
    log.info(f"Working directory: {work_dir}")

    try:
        # ── Step 1: Detect inputs ────────────────────────────────────────────
        with bench.step("Extract & detect inputs"):
            contents = extract_elvis_zip(args.elvis_zip, work_dir)

        las_strs = [str(f) for f in contents.las_files]
        dtm_filled      = os.path.join(work_dir, "dtm_filled.tif")
        scrub_count_raw = os.path.join(work_dir, "scrub_count_raw.tif")
        below_count_raw = os.path.join(work_dir, "below_count_raw.tif")

        footprint_path = os.path.join(work_dir, "footprint.geojson")

        # ── Step 2a: Obtain DTM ──────────────────────────────────────────────
        if contents.mode == MODE_DEM_ONLY or contents.mode == MODE_DEM_LAZ:
            with bench.step("Merge & reproject pre-built DEM (DTM)"):
                merge_dem_tiles(contents.dem_files, dtm_filled)
            with bench.step("Compute data footprint"):
                compute_data_footprint(dtm_filled, footprint_path)
        else:
            # MODE_LAZ_ONLY – build DTM + NRD counts from point cloud
            dtm_raw = os.path.join(work_dir, "dtm_raw.tif")
            with bench.step("PDAL: LAZ → DTM + NRD counts (ground classification)"):
                run_pdal_sequential_full(
                    las_strs, dtm_raw, scrub_count_raw, below_count_raw,
                    work_dir, resolution=1.0,
                )
            with bench.step("Fill DTM nodata holes"):
                fill_nodata(dtm_raw, dtm_filled)
            # Footprint is computed from dtm_raw (pre-fill) so fill_nodata's
            # 100 m extrapolation into outer nodata regions doesn't dilate the
            # outer boundary into a wedge artifact. Interior holes still get
            # bridged by the morphological close inside compute_data_footprint.
            with bench.step("Compute data footprint"):
                compute_data_footprint(dtm_raw, footprint_path)

        # ── Step 2b: Obtain NRD counts (only if vegetation layer needed) ────
        if contents.mode == MODE_DEM_LAZ:
            with bench.step("PDAL: LAZ → NRD counts (hag_dem)"):
                run_pdal_sequential_density(
                    las_strs, dtm_filled, scrub_count_raw, below_count_raw,
                    work_dir, resolution=1.0,
                )

        # ── Step 3: Derive rasters ───────────────────────────────────────────
        with bench.step("Compute hillshade, slope" + (", scrub density (vegetation)" if contents.has_vegetation else "")):
            if contents.has_vegetation:
                raster_paths = compute_rasters(dtm_filled, scrub_count_raw, below_count_raw, work_dir)
            else:
                raster_paths = compute_rasters_no_veg(dtm_filled, work_dir)

        # ── Step 4: Bounding box ─────────────────────────────────────────────
        lon_min, lat_min, lon_max, lat_max = get_raster_bbox_wgs84(dtm_filled)
        log.info(f"Coverage: lon {lon_min:.4f}–{lon_max:.4f}, lat {lat_min:.4f}–{lat_max:.4f}")

        # ── Step 5: OSM features ─────────────────────────────────────────────
        fp = footprint_path if os.path.exists(footprint_path) else None
        osm_geojson = None
        if not args.skip_osm:
            with bench.step("Fetch OSM features (Overpass API)"):
                osm_geojson = fetch_osm_features(lon_min, lat_min, lon_max, lat_max, work_dir,
                                                  footprint_path=fp)

        # ── Step 6: Contours ─────────────────────────────────────────────────
        with bench.step("Generate contours (5 m / 10 m / 50 m)"):
            contour_paths = generate_contours_gdal(dtm_filled, work_dir, footprint_path=fp)

        # ── Step 6b: Export GeoJSON for external vector tile generation ─────
        if args.export_geojson or args.export_footprint:
            export_dir = args.export_geojson or args.export_footprint
            os.makedirs(export_dir, exist_ok=True)
        if args.export_geojson:
            log.info(f"Exporting GeoJSON to {args.export_geojson} …")
            for interval, path in contour_paths.items():
                if os.path.exists(path):
                    shutil.copy2(path, os.path.join(args.export_geojson, f"contours_{interval}m.geojson"))
            if osm_geojson and os.path.exists(osm_geojson):
                shutil.copy2(osm_geojson, os.path.join(args.export_geojson, "osm_features.geojson"))
        if args.export_footprint and fp:
            fp_export_dir = args.export_footprint
            os.makedirs(fp_export_dir, exist_ok=True)
            shutil.copy2(fp, os.path.join(fp_export_dir, "footprint.geojson"))
            log.info(f"Footprint exported to {fp_export_dir}")

        # ── Step 7: Tile rendering ───────────────────────────────────────────
        active_layers = ["hillshade", "features", "slope", "contours"]
        if contents.has_vegetation:
            active_layers.insert(1, "vegetation")  # second from bottom

        # Filter to requested layers (--layers arg); "composite" is always produced
        if args.layers and args.layers.lower() != "all":
            requested = {l.strip().lower() for l in args.layers.split(",") if l.strip()}
            requested.discard("composite")  # always added by generate_all_tiles
            active_layers = [l for l in active_layers if l in requested]

        cfg = RenderConfig(
            hillshade_path=raster_paths["hillshade"],
            density_path=raster_paths.get("scrub_density", ""),
            slope_path=raster_paths["slope"],
            osm_geojson=osm_geojson,
            contour_paths=contour_paths,
            output_dir=args.output,
            layers=active_layers,
            lon_min=lon_min,
            lat_min=lat_min,
            lon_max=lon_max,
            lat_max=lat_max,
            footprint_path=fp,
        )

        with bench.step(f"Render tiles z{ZOOM_MIN}–z{ZOOM_MAX} ({args.workers} workers)"):
            generate_all_tiles(cfg, workers=args.workers)

        # ── Summary ──────────────────────────────────────────────────────────
        log.info(f"\n✓ Done! MBTiles written to: {args.output}")
        for name in active_layers + ["composite"]:
            log.info(f"  {name}.mbtiles")
        if not contents.has_vegetation:
            log.info("  (vegetation.mbtiles not produced — no LAZ/LAS in input ZIP)")

    finally:
        if use_temp and not args.keep_work:
            shutil.rmtree(work_dir, ignore_errors=True)
        elif args.keep_work:
            log.info(f"Intermediate files kept at: {work_dir}")

    bench.report()


if __name__ == "__main__":
    main()
