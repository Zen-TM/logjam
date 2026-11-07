#!/usr/bin/env python3
"""
build_weather.py
----------------
Publishes the Weather overlay's files: ECMWF IFS's forecast for NSW, hour by
hour, and its rain totals, cut from Open-Meteo's gridded files. Why a job
publishes them and why its reader is Open-Meteo's own: ADR 0048.

    python3 build_weather.py run --bucket B   # what the hourly ECS task runs
    python3 build_weather.py build OUT        # one build to a local folder

`run` reads the model's `latest.json` (about 4 KB) from Open-Meteo's public
bucket and stops there unless its run is newer than the one published. A new
run is read for the NSW box only (one range-read `.om` file per time step),
regridded onto web mercator tiles, and published under S3_PREFIX:

    latest.json                      WeatherMapFile in shared/src/weatherMap.ts
    runs/<run>/<field>/<step>.pmtiles   one per field and step
    runs/<run>/totals/<total>.pmtiles   rain totals around the anchor
    runs/<run>/wind.json             the wind arrows' grid, every step

A run's files go up before `latest.json` names them, and the run before is
kept, so a client holding the old manifest still finds its files.

Past rain is a model estimate, never a measurement: each past hour is read
from the run that began just before it (its first six hours), as Open-Meteo's
Historical Forecast API stitches them. Data: Open-Meteo.com, CC BY 4.0.
Requests hold only the model's name and times, never user input.
"""

import argparse
import gzip
import http.client
import json
import math
import os
import shutil
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np

FORMAT = 1
# WEATHER_MAP.prefix in shared/src/weatherMap.ts. Guard: tests/test_weather.py.
S3_PREFIX = f"master/weather/v{FORMAT}/"
MODEL = "ecmwf_ifs"
SOURCE_URL = f"https://openmeteo.s3.amazonaws.com/data_spatial/{MODEL}/"
ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0), ECMWF IFS"

# NSW_5M.coverage with about 2° around it, so the rain coming in shows.
BOX = (139.0, -39.5, 156.0, -26.0)  # west, south, east, north
# z5 pixels are about 4 km where IFS's cells are about 9 km: finer would be
# bytes for no detail. The four z5 tiles over BOX.
ZOOM = 5
TILE = 256
# ECMWF's reduced Gaussian grid as Open-Meteo stores it: 2N latitude lines,
# north first, line y holding 4y + 20 points from 0°E (to the equator).
GRID_N = 1280
GRID_POINTS = 4 * GRID_N * (GRID_N + 9)

RUN_EVERY = timedelta(hours=6)
FORECAST = timedelta(hours=168)  # the slider: to a week after the run
PAST = timedelta(hours=168)  # the longest past total
# A past hour is read from the run before it; if that run is gone, from one up
# to this much older (a later lead), and a total with an hour none holds is
# left out rather than drawn short.
PAST_LEAD_MAX = timedelta(hours=18)
WIND_STEP_DEG = 0.5


# A field per step: what the file holds, and how a value is rounded. Rain is a
# rate (mm/h) over the step, which is one to six hours long.
@dataclass(frozen=True)
class Field:
    key: str
    rounding: float


# Rounded as coarsely as the colours allow: a step's four tiles shrink by
# about half at 0.5° or 2 km/h, and no stop is closer than 5° or 10 km/h.
FIELDS = (
    Field("rain", 0.1),  # mm/h
    Field("temperature", 0.5),  # °C at 2 m
    Field("wind", 2.0),  # km/h at 10 m
    Field("gusts", 2.0),  # km/h at 10 m
)
VARIABLES = (
    "precipitation",
    "temperature_2m",
    "wind_u_component_10m",
    "wind_v_component_10m",
    "wind_gusts_10m",
)
MS_TO_KMH = 3.6

# Rain totals (mm), each over its hours from the anchor: `past` before it,
# the rest after. WEATHER_TOTALS in shared/src/weatherMap.ts.
TOTALS = {
    "rainPast168": -168,
    "rainPast72": -72,
    "rainPast24": -24,
    "rainNext24": 24,
    "rainNext72": 72,
}
TOTAL_ROUNDING = 0.1

HTTP_TRIES = 4
READ_THREADS = 16


# ── Time ─────────────────────────────────────────────────────────────────


def iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def parse_time(stamp: str) -> datetime:
    """Open-Meteo's `2026-11-07T00:00Z` or `2026-11-07T00:00:00Z`."""
    return datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(timezone.utc)


def run_id(run: datetime) -> str:
    return run.strftime("%Y%m%dT%H%MZ")


def step_path(run: datetime, valid: datetime) -> str:
    """The `.om` file of one run's step, under SOURCE_URL."""
    return f"{run:%Y/%m/%d/%H%M}Z/{valid:%Y-%m-%dT%H%M}.om"


def forecast_steps(
    valid_times: Sequence[datetime], run: datetime, anchor: datetime
) -> List[Tuple[datetime, int]]:
    """The slider's steps: (valid time, hours it covers) from the anchor to
    FORECAST after the run. A step covers back to the one before it: IFS is
    hourly to 90 h, then 3-hourly, then 6-hourly, and a step's rain is the
    sum over those hours."""
    out = []
    before = run
    for t in sorted(valid_times):
        if t > run + FORECAST:
            break
        hours = round((t - before).total_seconds() / 3600)
        before = t
        if t >= anchor and hours > 0:
            out.append((t, hours))
    return out


def past_sources(hour: datetime) -> List[datetime]:
    """The runs a past hour's rain may come from, best first: the run that
    began just before it (lead 1 to 6 h), then older ones to PAST_LEAD_MAX."""
    since = hour - timedelta(hours=1)
    first = datetime.fromtimestamp(
        (since.timestamp() // RUN_EVERY.total_seconds()) * RUN_EVERY.total_seconds(),
        timezone.utc,
    )
    out = []
    run = first
    while hour - run <= PAST_LEAD_MAX:
        out.append(run)
        run -= RUN_EVERY
    return out


def anchor_of(now: datetime) -> datetime:
    """Totals are counted from the build's hour: the past up to it, the
    forecast after it."""
    return now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


# ── The grid ─────────────────────────────────────────────────────────────


def grid_lines() -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(points per line, first index of each line, latitude of each line):
    Open-Meteo's O1280, which spaces the lines evenly (its GaussianGrid)."""
    y = np.arange(2 * GRID_N)
    nx = np.where(y < GRID_N, y * 4 + 20, (2 * GRID_N - y - 1) * 4 + 20)
    start = np.concatenate([[0], np.cumsum(nx)[:-1]])
    dy = 180.0 / (2 * GRID_N + 0.5)
    lat = (GRID_N - y - 1) * dy + dy / 2
    return nx, start, lat


@dataclass
class Cut:
    """The part of the grid read for BOX: per line, a run of points."""

    lines: np.ndarray  # line numbers
    first: np.ndarray  # first point read on each line
    count: np.ndarray  # points read on each line
    offset: np.ndarray  # where each line starts in the cut


def box_cut(box=BOX) -> Cut:
    """Every line and point a bilinear sample inside `box` can touch."""
    west, south, east, north = box
    nx, _, lat = grid_lines()
    dy = 180.0 / (2 * GRID_N + 0.5)
    lines = np.where((lat >= south - 2 * dy) & (lat <= north + 2 * dy))[0]
    first = np.floor(west / 360 * nx[lines]).astype(np.int64) - 1
    last = np.ceil(east / 360 * nx[lines]).astype(np.int64) + 1
    count = last - first + 1
    offset = np.concatenate([[0], np.cumsum(count)[:-1]])
    return Cut(lines, first, count, offset)


def sample_weights(
    cut: Cut, lon: np.ndarray, lat: np.ndarray
) -> Tuple[np.ndarray, np.ndarray]:
    """For each point, the four cut indices around it and their bilinear
    weights: between the two lines either side, and on each line between
    the two points either side (lines hold different numbers of points)."""
    nx, _, _ = grid_lines()
    dy = 180.0 / (2 * GRID_N + 0.5)
    yf = GRID_N - 1 - (lat - dy / 2) / dy
    y0 = np.floor(yf).astype(np.int64)
    wy = yf - y0
    where = {int(line): i for i, line in enumerate(cut.lines)}
    idx = np.empty((4, lon.size), np.int64)
    w = np.empty((4, lon.size))
    for k, (dline, wline) in enumerate(((0, 1 - wy), (1, wy))):
        y = y0 + dline
        i = np.array([where[int(v)] for v in y])
        xf = (lon % 360) / 360 * nx[y]
        x0 = np.floor(xf).astype(np.int64)
        wx = xf - x0
        base = cut.offset[i] + (x0 - cut.first[i])
        if np.any(x0 < cut.first[i]) or np.any(x0 + 1 >= cut.first[i] + cut.count[i]):
            raise ValueError("a sample falls outside the cut")
        idx[2 * k], w[2 * k] = base, wline * (1 - wx)
        idx[2 * k + 1], w[2 * k + 1] = base + 1, wline * wx
    return idx, w


def regrid(values: np.ndarray, idx: np.ndarray, w: np.ndarray) -> np.ndarray:
    """Bilinear samples; NaN where any of the four is."""
    return (values[idx] * w).sum(axis=0)


def tiles_over(box=BOX, zoom=ZOOM) -> List[Tuple[int, int]]:
    west, south, east, north = box
    n = 2**zoom

    def tile(lon, lat):
        x = int((lon + 180) / 360 * n)
        y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
        return x, y

    x0, y0 = tile(west, north)
    x1, y1 = tile(east, south)
    return [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]


def tile_pixels(x: int, y: int, zoom=ZOOM) -> Tuple[np.ndarray, np.ndarray]:
    """Lon and lat of each pixel centre of a tile, row by row from the top."""
    n = 2**zoom
    i = (np.arange(TILE) + 0.5) / TILE
    lon = (x + i) / n * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y + i) / n))))
    lons, lats = np.meshgrid(lon, lat)
    return lons.ravel(), lats.ravel()


@dataclass
class Plan:
    """What one build samples: each tile's in-box pixels, and the arrows."""

    cut: Cut
    tiles: List[Tuple[int, int, np.ndarray, np.ndarray, np.ndarray]]
    wind_shape: Tuple[int, int]
    wind_idx: np.ndarray
    wind_w: np.ndarray


def plan(box=BOX) -> Plan:
    west, south, east, north = box
    cut = box_cut(box)
    tiles = []
    for x, y in tiles_over(box):
        lon, lat = tile_pixels(x, y)
        inside = (lon >= west) & (lon <= east) & (lat >= south) & (lat <= north)
        idx, w = sample_weights(cut, lon[inside], lat[inside])
        tiles.append((x, y, inside, idx, w))
    wlon = np.arange(west, east + 1e-9, WIND_STEP_DEG)
    wlat = np.arange(north, south - 1e-9, -WIND_STEP_DEG)
    lons, lats = np.meshgrid(wlon, wlat)
    widx, ww = sample_weights(cut, lons.ravel(), lats.ravel())
    return Plan(cut, tiles, (wlat.size, wlon.size), widx, ww)


# ── Encoding ─────────────────────────────────────────────────────────────


def write_pmtiles(path: Path, tiles: List[Tuple[int, int, bytes]], box=BOX) -> None:
    """One zoom of terrarium PNG tiles, with the box as its bounds."""
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import Writer

    west, south, east, north = box
    e7 = lambda v: int(round(v * 1e7))  # noqa: E731
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        writer = Writer(f)
        for x, y, png in sorted(tiles, key=lambda t: zxy_to_tileid(ZOOM, t[0], t[1])):
            writer.write_tile(zxy_to_tileid(ZOOM, x, y), png)
        writer.finalize(
            {
                "tile_type": TileType.PNG,
                "tile_compression": Compression.NONE,
                "min_lon_e7": e7(west),
                "min_lat_e7": e7(south),
                "max_lon_e7": e7(east),
                "max_lat_e7": e7(north),
                "center_zoom": ZOOM,
                "center_lon_e7": e7((west + east) / 2),
                "center_lat_e7": e7((south + north) / 2),
            },
            {"attribution": ATTRIBUTION, "encoding": "terrarium"},
        )


def field_tiles(
    plan_: Plan, values: np.ndarray, rounding: float
) -> List[Tuple[int, int, bytes]]:
    from build_nsw_dem import encode_terrarium, png_bytes

    out = []
    for x, y, inside, idx, w in plan_.tiles:
        pixels = np.full(TILE * TILE, np.nan)
        pixels[inside] = regrid(values, idx, w)
        grid = pixels.reshape(TILE, TILE)
        valid = np.isfinite(grid)
        rgb = encode_terrarium(np.where(valid, grid, 0), valid, rounding)
        out.append((x, y, png_bytes(rgb)))
    return out


def step_fields(cuts: Dict[str, np.ndarray], hours: int) -> Dict[str, np.ndarray]:
    """A step's fields from its variables, on the cut. Speed is taken after
    regridding the components (in `wind_arrows`) for the arrows; for the
    colour field it is taken per grid point, which keeps a calm cell calm."""
    u, v = cuts["wind_u_component_10m"], cuts["wind_v_component_10m"]
    return {
        "rain": cuts["precipitation"] / hours,
        "temperature": cuts["temperature_2m"],
        "wind": np.hypot(u, v) * MS_TO_KMH,
        "gusts": cuts["wind_gusts_10m"] * MS_TO_KMH,
    }


def wind_arrows(plan_: Plan, cuts: Dict[str, np.ndarray]) -> Dict[str, list]:
    """Speed (km/h) and the direction the wind blows from (degrees, as a
    forecast states it), per arrow point, rounded; null where unknown."""
    u = regrid(cuts["wind_u_component_10m"], plan_.wind_idx, plan_.wind_w)
    v = regrid(cuts["wind_v_component_10m"], plan_.wind_idx, plan_.wind_w)
    speed = np.hypot(u, v) * MS_TO_KMH
    # u, v blow towards east and north; from = 180° away from that.
    direction = (np.degrees(np.arctan2(u, v)) + 180) % 360
    known = np.isfinite(speed)
    return {
        "speed": [int(round(s)) if k else None for s, k in zip(speed, known)],
        "from": [int(round(d)) % 360 if k else None for d, k in zip(direction, known)],
    }


# ── Reading Open-Meteo ───────────────────────────────────────────────────


class Missing(Exception):
    """The source has no such file."""


def get_url(url: str, headers: Optional[dict] = None, method: str = "GET") -> bytes:
    request = urllib.request.Request(url, headers=headers or {}, method=method)
    for attempt in range(HTTP_TRIES):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                if method == "HEAD":
                    return response.headers.get("Content-Length", "0").encode()
                return response.read()
        except urllib.error.HTTPError as err:
            # The public bucket lists, so a missing key is a 404; S3 answers
            # 403 for one when listing is off.
            if err.code in (403, 404):
                raise Missing(url) from err
            if attempt == HTTP_TRIES - 1:
                raise
        # A dropped connection (RemoteDisconnected) is an OSError, not a
        # URLError; a short body is an HTTPException.
        except (urllib.error.URLError, OSError, http.client.HTTPException):
            if attempt == HTTP_TRIES - 1:
                raise
        time.sleep(2**attempt)
    raise AssertionError("unreachable")


class RangeFile:
    """What omfiles' `from_fsspec` asks of a file system (`size`,
    `cat_file`), over HTTP range reads of 64 KB blocks. The reader asks for
    each 1024-point chunk on its own; blocks turn hundreds of those into
    tens of requests a step. 256 KB blocks read 60% more for a third fewer
    requests (one step: 3.4 MB against 2.1 MB)."""

    BLOCK = 1 << 16
    # Bytes every RangeFile has read, for the build's log line.
    total = 0
    _lock = threading.Lock()

    def __init__(self, base: str = SOURCE_URL):
        self.base = base
        self.blocks: Dict[Tuple[str, int], bytes] = {}

    def size(self, path: str) -> int:
        return int(get_url(self.base + path, method="HEAD"))

    def _block(self, path: str, i: int) -> bytes:
        key = (path, i)
        if key not in self.blocks:
            span = f"bytes={i * self.BLOCK}-{(i + 1) * self.BLOCK - 1}"
            self.blocks[key] = get_url(self.base + path, {"Range": span})
            with RangeFile._lock:
                RangeFile.total += len(self.blocks[key])
        return self.blocks[key]

    def cat_file(self, path: str, start: int, end: int, **_kw) -> bytes:
        first, last = start // self.BLOCK, (end - 1) // self.BLOCK
        data = b"".join(self._block(path, i) for i in range(first, last + 1))
        at = start - first * self.BLOCK
        return data[at : at + end - start]


def read_cut(path: str, variables: Sequence[str], cut: Cut) -> Dict[str, np.ndarray]:
    """Each variable's values on the cut, from one `.om` file. Open-Meteo's
    reader (GPL-2.0-only) is imported here, in the job's image only: ADR 0048."""
    import omfiles

    reader = omfiles.OmFileReader.from_fsspec(RangeFile(), path)
    _, start, _ = grid_lines()
    out = {}
    for name in variables:
        var = reader.get_child_by_name(name)
        if tuple(var.shape) != (1, GRID_POINTS):
            raise ValueError(f"{name} has shape {var.shape}, not O{GRID_N}")
        parts = []
        for line, first, count in zip(cut.lines, cut.first, cut.count):
            at = int(start[line] + first)
            parts.append(var.read_array((0, slice(at, at + int(count)))))
        out[name] = np.concatenate(parts).astype(np.float64)
    reader.close()
    return out


Read = Callable[[str, Sequence[str]], Dict[str, np.ndarray]]


# ── Building ─────────────────────────────────────────────────────────────


def check_source(latest: dict) -> datetime:
    """The run `latest.json` describes, once it is complete and on the grid
    this job samples."""
    if not latest.get("completed"):
        raise SystemExit("the latest run is not complete")
    if f"O{GRID_N}" not in latest.get("crs_wkt", ""):
        raise SystemExit(f"{MODEL} is no longer on O{GRID_N}: check the grid")
    missing = set(VARIABLES) - set(latest.get("variables", []))
    if missing:
        raise SystemExit(f"{MODEL} lacks {sorted(missing)}")
    return parse_time(latest["reference_time"])


def totals_from(
    anchor: datetime,
    forecast_rain: Dict[datetime, Tuple[int, np.ndarray]],
    past_rain: Dict[datetime, np.ndarray],
) -> Dict[str, np.ndarray]:
    """Each total whose every hour is known. `forecast_rain` holds a step's
    sum and its hours by valid time; `past_rain` an hour's by its end."""
    out = {}
    for key, hours in TOTALS.items():
        if hours < 0:
            want = [anchor - timedelta(hours=h) for h in range(-hours)]
            if all(t in past_rain for t in want):
                out[key] = sum(past_rain[t] for t in want)
            continue
        end = anchor + timedelta(hours=hours)
        steps = [(t, s) for t, s in forecast_rain.items() if anchor < t <= end]
        covered = sum(h for _, (h, _) in steps)
        if covered == hours:
            out[key] = sum(v for _, (_, v) in steps)
    return out


def build(
    latest: dict,
    now: datetime,
    out: Path,
    read: Optional[Read] = None,
    box=BOX,
) -> dict:
    """One run's files under `out`; returns its manifest."""
    plan_ = plan(box)
    read = read or (lambda path, names: read_cut(path, names, plan_.cut))
    run = check_source(latest)
    anchor = anchor_of(now)
    valid = [parse_time(t) for t in latest["valid_times"]]
    steps = forecast_steps(valid, run, anchor)
    if not steps:
        raise SystemExit(f"run {iso(run)} has no step after {iso(anchor)}")
    folder = f"runs/{run_id(run)}/"

    # Hours of past rain: the latest run's own first hours up to the anchor,
    # then each earlier hour from the run before it.
    past_hours = [
        anchor - timedelta(hours=h) for h in range(int(PAST.total_seconds() // 3600))
    ]

    def read_step(i_step):
        i, (t, hours) = i_step
        cuts = read(step_path(run, t), VARIABLES)
        fields = step_fields(cuts, hours)
        for f in FIELDS:
            write_pmtiles(
                out / folder / f.key / f"{i:03d}.pmtiles",
                field_tiles(plan_, fields[f.key], f.rounding),
                box,
            )
        return t, hours, cuts["precipitation"], wind_arrows(plan_, cuts)

    def read_past(hour):
        for source in [run] if hour > run else past_sources(hour):
            try:
                return hour, read(step_path(source, hour), ["precipitation"])[
                    "precipitation"
                ]
            except Missing:
                continue
        print(f"no run holds rain for {iso(hour)}", flush=True)
        return hour, None

    with ThreadPoolExecutor(READ_THREADS) as pool:
        done = list(pool.map(read_step, enumerate(steps)))
        past = dict(pool.map(read_past, past_hours))

    forecast_rain = {t: (hours, rain) for t, hours, rain, _ in done}
    past_rain = {t: v for t, v in past.items() if v is not None}
    totals = totals_from(anchor, forecast_rain, past_rain)
    for key, values in totals.items():
        write_pmtiles(
            out / folder / "totals" / f"{key}.pmtiles",
            field_tiles(plan_, values, TOTAL_ROUNDING),
            box,
        )
    west, _, _, north = box
    rows, cols = plan_.wind_shape
    wind = {
        "west": west,
        "north": north,
        "step": WIND_STEP_DEG,
        "columns": cols,
        "rows": rows,
        "steps": [arrows for _, _, _, arrows in done],
    }
    (out / folder / "wind.json").write_text(json.dumps(wind, separators=(",", ":")))
    return {
        "format": FORMAT,
        "model": MODEL,
        "run": iso(run),
        "built": iso(now),
        "anchor": iso(anchor),
        "path": folder,
        "bounds": list(box),
        "zoom": ZOOM,
        "steps": [{"time": iso(t), "hours": h} for t, h in steps],
        "totals": [k for k in TOTALS if k in totals],
        "attribution": ATTRIBUTION,
    }


# ── Publishing ───────────────────────────────────────────────────────────


def read_manifest(s3, bucket: str) -> Optional[dict]:
    """The published manifest, or None. Listed first: a GetObject of a
    missing key is AccessDenied to a role that may list only its prefix."""
    key = S3_PREFIX + "latest.json"
    if s3.list_objects_v2(Bucket=bucket, Prefix=key, MaxKeys=1).get("KeyCount", 0) == 0:
        return None
    return json.loads(
        gzip.decompress(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
    )


def upload(s3, bucket: str, out: Path, manifest: dict) -> None:
    """The run's files, then the manifest that names them."""
    for path in sorted((out / manifest["path"]).rglob("*")):
        if not path.is_file():
            continue
        key = S3_PREFIX + str(path.relative_to(out))
        body = path.read_bytes()
        extra = {"ContentType": "application/vnd.pmtiles"}
        if path.suffix == ".json":
            body = gzip.compress(body, compresslevel=9, mtime=0)
            extra = {"ContentType": "application/json", "ContentEncoding": "gzip"}
        # A run's files never change once written: its folder is its name.
        s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=body,
            CacheControl="public, max-age=86400, immutable",
            **extra,
        )
    s3.put_object(
        Bucket=bucket,
        Key=S3_PREFIX + "latest.json",
        Body=gzip.compress(json.dumps(manifest).encode(), compresslevel=9, mtime=0),
        ContentType="application/json",
        ContentEncoding="gzip",
        CacheControl="public, max-age=300",
    )


def prune(s3, bucket: str, keep: Sequence[str]) -> None:
    """Every run folder but `keep` (the new run and the one before it)."""
    doomed = []
    for page in s3.get_paginator("list_objects_v2").paginate(
        Bucket=bucket, Prefix=S3_PREFIX + "runs/"
    ):
        for obj in page.get("Contents", []):
            folder = obj["Key"][len(S3_PREFIX) :].split("/", 2)
            if f"{folder[0]}/{folder[1]}/" not in keep:
                doomed.append({"Key": obj["Key"]})
    for i in range(0, len(doomed), 1000):
        s3.delete_objects(Bucket=bucket, Delete={"Objects": doomed[i : i + 1000]})
    if doomed:
        print(f"pruned {len(doomed)} files of older runs")


def run(bucket: str, s3=None, get: Callable[[str], bytes] = get_url, now=None) -> None:
    if s3 is None:
        import boto3

        s3 = boto3.client("s3")
    latest = json.loads(get(SOURCE_URL + "latest.json"))
    source_run = check_source(latest)
    old = read_manifest(s3, bucket)
    if old is not None and parse_time(old["run"]) >= source_run:
        print(f"up to date: {old['run']}")
        return
    now = now or datetime.now(timezone.utc)
    print(f"building {MODEL} {iso(source_run)}", flush=True)
    started = time.monotonic()
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        manifest = build(latest, now, out)
        upload(s3, bucket, out, manifest)
    keep = [manifest["path"]] + ([old["path"]] if old else [])
    prune(s3, bucket, keep)
    print(
        f"published {manifest['run']}: {len(manifest['steps'])} steps, "
        f"totals {manifest['totals']}, read {RangeFile.total / 1e6:.0f} MB, "
        f"{time.monotonic() - started:.0f} s"
    )


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run", help="build a new run and publish it to S3")
    r.add_argument("--bucket", default=os.environ.get("S3_BUCKET_TOPO"))
    b = sub.add_parser("build", help="build the latest run into a local folder")
    b.add_argument("out", type=Path)
    args = parser.parse_args(argv)
    if args.command == "run":
        if not args.bucket:
            parser.error("run needs --bucket or S3_BUCKET_TOPO")
        run(args.bucket)
        return 0
    latest = json.loads(get_url(SOURCE_URL + "latest.json"))
    started = time.monotonic()
    if args.out.exists():
        shutil.rmtree(args.out)
    manifest = build(latest, datetime.now(timezone.utc), args.out)
    (args.out / "latest.json").write_text(json.dumps(manifest, indent=1))
    print(
        f"built {manifest['run']}: read {RangeFile.total / 1e6:.0f} MB, "
        f"{time.monotonic() - started:.0f} s"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
