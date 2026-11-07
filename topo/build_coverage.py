#!/usr/bin/env python3
"""
build_coverage.py
------------------
The Coverage overlay's archive (`NSW_COVERAGE` in shared/src/nswCoverage.ts):
for each carrier, where its own model predicts a phone works in the hand
outdoors, works only with an external antenna, or has no coverage, over the
land of the NSW box.

    python3 build_coverage.py publish --bucket B   # the monthly ECS task
    python3 build_coverage.py fetch DIR            # the latest maps, by hand
    python3 build_coverage.py build DIR OUT        # and the archive from them

Source: the ACCC Mobile Infrastructure Report data release on data.gov.au,
one KML per carrier, technology and level each year, as at 31 January. Its
licence there is CC BY 2.5 AU. The coastline that keeps the sea unhatched is
the ABS's Australia outline (ASGS Edition 3), CC BY 4.0. `CREDIT` credits
both, as shared's `NSW_COVERAGE.credit` does.

How the release maps to a carrier (its data interpretation guide, v6):

- Outdoor is a handset held at head height outdoors; Ext Ant is a phone with
  an external antenna, which reaches further. A place is "external" when it
  is in any Ext Ant map but no Outdoor one, and "none" when it is in neither.
- 4G, 5G and 5G NSA count; 3G is switched off. Telstra has no 5G Ext Ant
  map, so a carrier's Outdoor maps count towards its Ext Ant too.
- The Optus-TPG MOCN counts for both Optus and TPG. "TPG's coverage maps do
  not include coverage it could access via its roaming agreement with Optus"
  (the guide's footnote 11), and "TPG wholesale customers have access to both
  TPG's retail coverage and the coverage TPG can access under Optus-TPG MOCN
  arrangement" (footnote 14). That TPG's own customers use it is inferred from
  those. For Optus it changes nothing: Optus's own maps already cover all of
  the MOCN in NSW (the 2026 maps, measured).
- The retail maps only: Telstra's Wholesale maps are its resellers', smaller.

`publish` asks data.gov.au's CKAN API for the release's resources, picks the
latest year's maps, and does nothing when they are the ones the published
state lists. Otherwise it downloads them one at a time, builds, and uploads
the archive, then the state, to ARCHIVE_KEY and STATE_KEY in the topo bucket.

Each map is burnt into a grid of GRID_DEG cells (about 50 m) and the classes
are traced back into polygons: unioning the source polygons as vectors, 800 MB
of KML for one carrier, is far slower and needs far more memory. The source
models themselves are about 100 m cells, so the grid loses nothing they hold.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import IO, Callable, Dict, Iterable, Iterator, List, Optional

import numpy as np
import shapely
from osgeo import gdal, gdal_array, ogr, osr

gdal.UseExceptions()
ogr.UseExceptions()
osr.UseExceptions()

PACKAGE_URL = (
    "https://data.gov.au/data/api/3/action/package_show?id="
    "accc-mobile-infrastructure-report-data-release"
)
COASTLINE_URL = (
    "https://www.abs.gov.au/statistics/standards/"
    "australian-statistical-geography-standard-asgs-edition-3/jul2021-jun2026/"
    "access-and-downloads/digital-boundary-files/AUS_2021_AUST_SHP_GDA2020.zip"
)
# data.gov.au and the ABS both answer a script; this says which one.
USER_AGENT = "logjam-coverage-build"
COASTLINE = "coastline.zip"
HTTP_TRIES = 4

# The release's network names, for each carrier a user picks: `CARRIERS` in
# shared/src/nswCoverage.ts lists the same ids (test_coverage.py).
NETWORKS = {
    "telstra": ("Telstra",),
    "optus": ("Optus", "Optus-TPG MOCN"),
    "tpg": ("TPG", "Optus-TPG MOCN"),
}
TECHNOLOGIES = ("4G", "5G", "5G NSA")
OUTDOOR, EXT_ANT = "Outdoor", "Ext Ant"
# A resource's name, e.g. "Coverage map - Optus-TPG MOCN - 5G NSA - Ext Ant -
# 2026". The pattern ends at the year, so "... - Outdoor - Wholesale - 2026"
# and "Coverage maps by frequency band" never match.
NAME_PATTERN = re.compile(
    r"Coverage map - (?P<network>Telstra|Optus-TPG MOCN|Optus|TPG)"
    r" - (?P<technology>4G|5G NSA|5G) - (?P<level>Outdoor|Ext Ant) - (?P<year>\d{4})"
)

# The class each cell gets, traced into the `level` attribute. `LEVELS` in
# shared/src/nswCoverage.ts lists the same names (test_coverage.py).
LEVELS = {1: "outdoor", 2: "external", 3: "none"}
# The NSW box, `NSW_5M.coverage` in shared/src/demSources.ts: west, south,
# east, north.
BOX = (140.9, -37.6, 153.7, -28.0)
GRID_DEG = 0.0005
# Polygons rasterized at once. Each call costs a pass over the grid, about
# half a second, and its geometries stay in memory until it ends.
BATCH = 20_000
SPLIT_POINTS = 2_000
# Cells traced at once (about 0.5°): the most one traced polygon can span.
BLOCK = 1024

SOURCE_LAYER = "coverage"
ZMIN = 8
ZMAX = 12
CREDIT = (
    "Mobile coverage: ACCC Mobile Infrastructure Report data release"
    " © Commonwealth of Australia (ACCC), CC BY 2.5 AU; coastline © ABS, CC BY 4.0"
)
ARCHIVE_KEY = "master/coverage/nsw-coverage.pmtiles"
STATE_KEY = "master/coverage/nsw-coverage.json"

Get = Callable[[str], dict]
Download = Callable[[str, Path], None]


# ── The release ──────────────────────────────────────────────────────────


def _open(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(request, timeout=300)


def _retried(what: str, call):
    for attempt in range(HTTP_TRIES):
        try:
            return call()
        except OSError as err:  # URLError, HTTPError, timeouts, resets
            if attempt == HTTP_TRIES - 1:
                raise
            print(f"  {what} failed ({err}), retrying …", flush=True)
            time.sleep(15 * 2**attempt)


def get_json(url: str) -> dict:
    def call():
        with _open(url) as resp:
            return json.load(resp)

    return _retried(url, call)


def download(url: str, dest: Path) -> None:
    def call():
        with _open(url) as resp, open(dest, "wb") as out:
            shutil.copyfileobj(resp, out, 1 << 20)

    _retried(url, call)


def latest_maps(resources: Iterable[dict]) -> dict:
    """The latest year's maps that count, as the state `publish` compares
    and records: {"year", "maps": [{network, technology, level, id, url,
    modified}]}. Every carrier must have an Outdoor and an Ext Ant map that
    year, or the release is mid-upload and nothing is built."""
    found = []
    for r in resources:
        # The guide and some resource names use an en dash.
        match = NAME_PATTERN.fullmatch(r.get("name", "").replace("–", "-").strip())
        if match:
            found.append({**match.groupdict(), "resource": r})
    if not found:
        raise SystemExit("no coverage maps in the release")
    year = max(f["year"] for f in found)
    maps = sorted(
        (
            {
                "network": f["network"],
                "technology": f["technology"],
                "level": f["level"],
                "id": f["resource"]["id"],
                "url": f["resource"]["url"],
                "modified": f["resource"].get("last_modified")
                or f["resource"].get("metadata_modified"),
            }
            for f in found
            if f["year"] == year
        ),
        key=lambda m: (m["network"], m["technology"], m["level"]),
    )
    for carrier, networks in NETWORKS.items():
        levels = {m["level"] for m in maps if m["network"] in networks}
        if levels != {OUTDOOR, EXT_ANT}:
            raise SystemExit(f"{year}: {carrier} has only {sorted(levels)} maps")
    return {"year": int(year), "maps": maps}


def maps_for(carrier: str, level: str, maps: List[dict]) -> List[dict]:
    """The maps whose union is `level` for `carrier`. `classify` adds the
    Outdoor ones to Ext Ant: Telstra has no 5G Ext Ant map at all."""
    return [
        m for m in maps if m["network"] in NETWORKS[carrier] and m["level"] == level
    ]


def file_name(m: dict) -> str:
    """The local name of a map's download: its URL's own, which keeps .kml
    or .zip."""
    return Path(urllib.parse.urlparse(m["url"]).path).name


# ── The grid ─────────────────────────────────────────────────────────────


def grid_shape() -> tuple:
    west, south, east, north = BOX
    return round((north - south) / GRID_DEG), round((east - west) / GRID_DEG)


def classify(land, outdoor, external):
    """Each cell's `LEVELS` key, in place in `external`, which it returns: 0
    off the land, else 1 in an Outdoor map, 2 in only an Ext Ant one, 3 in
    neither. All three are 0/1 uint8 grids; in-place arithmetic, because a
    grid is half a gigabyte and a boolean mask of it is as much again."""
    external |= outdoor  # whatever works in the hand works with an antenna
    external += outdoor  # 2 in the hand, 1 with an antenna only, 0 neither
    external ^= 3  # 1, 2, 3
    external *= land
    return external


def _ring(coordinates: str) -> str:
    """A KML `<coordinates>` ("lon,lat[,alt] ...") as a WKT polygon of that
    ring alone."""
    points = (p.split(",", 2) for p in coordinates.split())
    return "POLYGON((" + ",".join(f"{p[0]} {p[1]}" for p in points) + "))"


def kml_polygons(stream: IO[bytes]) -> Iterator[List[str]]:
    """Each polygon in a KML document, one at a time, as its rings: the
    outer one, then its holes, each a WKT polygon of its own. GDAL's KML
    driver reads a whole document into memory first, and one map unzips to
    1.7 GB, 445 MB of it one placemark."""
    rings: List[str] = []
    open_elements: List[ET.Element] = []
    for event, element in ET.iterparse(stream, events=("start", "end")):
        if event == "start":
            open_elements.append(element)
            continue
        open_elements.pop()
        tag = element.tag.rsplit("}", 1)[-1]
        if tag == "coordinates" and element.text:
            # KML lists a polygon's outer boundary before its inner ones.
            rings.append(_ring(element.text))
            element.clear()
        elif tag == "Polygon":
            if rings:
                yield rings
            rings = []
            element.clear()
        elif tag == "SimpleData":
            element.clear()  # an attribute: one map's repeats each geometry
        elif tag == "Placemark":
            rings = []
            # Its folder would keep every placemark parsed, text and all.
            # Guard: test_coverage.py, test_a_placemark_is_freed_once_read.
            if open_elements:
                open_elements[-1].remove(element)


def _kml_streams(path: Path) -> Iterator[IO[bytes]]:
    """A KML download as it is, or each KML in a zipped one."""
    if path.suffix.lower() != ".zip":
        with open(path, "rb") as stream:
            yield stream
        return
    with zipfile.ZipFile(path) as archive:
        names = [n for n in archive.namelist() if n.lower().endswith(".kml")]
        if not names:
            raise SystemExit(f"{path.name} holds no KML")
        for name in names:
            with archive.open(name) as stream:
                yield stream


def _grid_dataset(grid):
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(4326)
    ds = gdal_array.OpenArray(grid)  # a MEM dataset over the array's own memory
    ds.SetGeoTransform((BOX[0], GRID_DEG, 0, BOX[3], 0, -GRID_DEG))
    ds.SetProjection(srs.ExportToWkt())
    return ds, srs


def in_box(bounds: tuple) -> bool:
    """Whether bounds (west, south, east, north) meet BOX."""
    west, south, east, north = BOX
    return not (
        bounds[2] < west or bounds[0] > east or bounds[3] < south or bounds[1] > north
    )


def _cut(value: float, origin: float) -> float:
    """The grid line nearest `value`: a cut there never passes through a
    cell's centre, so no cell is lost between the two halves."""
    return origin + round((value - origin) / GRID_DEG) * GRID_DEG


def pieces(geometry) -> Iterator:
    """`geometry` (shapely), halved until each piece has at most SPLIT_POINTS
    points. GDAL fills a polygon a row at a time across every one of its
    edges, so one map's regional polygon of a million points cost rows ×
    edges, half an hour; each halving costs one pass over its points."""
    stack = [shapely.clip_by_rect(geometry, *BOX)]
    while stack:
        piece = stack.pop()
        if piece.is_empty:
            continue
        west, south, east, north = piece.bounds
        wide, tall = east - west, north - south
        if (
            shapely.get_num_coordinates(piece) <= SPLIT_POINTS
            or max(wide, tall) < 2 * GRID_DEG
        ):
            yield piece
            continue
        if wide >= tall:
            cut = _cut((west + east) / 2, BOX[0])
            halves = [(west, south, cut, north), (cut, south, east, north)]
        else:
            cut = _cut((south + north) / 2, BOX[3])
            halves = [(west, south, east, cut), (west, cut, east, north)]
        stack.extend(shapely.clip_by_rect(piece, *half) for half in halves)


class _Filler:
    """Burns `value` into a dataset under each geometry added, BATCH at a time."""

    def __init__(self, ds, srs, value: int):
        self.ds, self.srs, self.value, self.batch = ds, srs, value, []

    def add(self, geometries: Iterable) -> None:
        for geometry in geometries:
            self.batch.append(geometry)
            if len(self.batch) == BATCH:
                self.flush()

    def flush(self) -> None:
        if not self.batch:
            return
        mem = ogr.GetDriverByName("MEM").CreateDataSource("")
        layer = mem.CreateLayer("batch", self.srs, ogr.wkbUnknown)
        for geometry in self.batch:
            feature = ogr.Feature(layer.GetLayerDefn())
            feature.SetGeometry(ogr.CreateGeometryFromWkb(shapely.to_wkb(geometry)))
            layer.CreateFeature(feature)
        gdal.RasterizeLayer(self.ds, [1], layer, burn_values=[self.value])
        self.batch.clear()


def window(bounds: tuple) -> Optional[tuple]:
    """The rows and columns of the grid that `bounds` covers, as slices, or
    None outside it."""
    height, width = grid_shape()
    west, south, east, north = bounds
    col0 = max(0, int((west - BOX[0]) // GRID_DEG))
    col1 = min(width, int(-(-(east - BOX[0]) // GRID_DEG)))
    row0 = max(0, int((BOX[3] - north) // GRID_DEG))
    row1 = min(height, int(-(-(BOX[3] - south) // GRID_DEG)))
    if col0 >= col1 or row0 >= row1:
        return None
    return slice(row0, row1), slice(col0, col1)


def burn_kml(grid, path: Path) -> int:
    """Set to 1 every cell of `grid` (a uint8 array over BOX) whose centre is
    in a polygon of the KML map at `path`; return how many polygons were in
    the box.

    A polygon with holes is filled in a scratch window over its own bounds:
    its outer ring, then each hole burnt back to 0, then OR-ed into the grid.
    Filled whole, a polygon with 780,000 holes costs every row of it a pass
    over every hole's edges, and clipping it to pieces is as slow."""
    ds, srs = _grid_dataset(grid)
    filler = _Filler(ds, srs, 1)
    found = 0
    for stream in _kml_streams(path):
        for rings in kml_polygons(stream):
            outer = shapely.from_wkt(rings[0])
            if not in_box(outer.bounds):
                continue
            found += 1
            if len(rings) == 1:
                filler.add(pieces(outer))
                continue
            rows, cols = window(outer.bounds) or (None, None)
            if rows is None:
                continue
            scratch = np.zeros(
                (rows.stop - rows.start, cols.stop - cols.start), np.uint8
            )
            sds = gdal_array.OpenArray(scratch)
            sds.SetGeoTransform(
                (
                    BOX[0] + cols.start * GRID_DEG,
                    GRID_DEG,
                    0,
                    BOX[3] - rows.start * GRID_DEG,
                    0,
                    -GRID_DEG,
                )
            )
            sds.SetProjection(srs.ExportToWkt())
            inside = _Filler(sds, srs, 1)
            inside.add(pieces(outer))
            inside.flush()
            holes = _Filler(sds, srs, 0)
            for hole in rings[1:]:
                holes.add(pieces(shapely.from_wkt(hole)))
            holes.flush()
            sds.FlushCache()
            grid[rows, cols] |= scratch
    filler.flush()
    ds.FlushCache()
    return found


def burn_land(grid, coastline: Path) -> int:
    """Set to 1 every cell of `grid` on land: the coastline is a zipped
    shapefile, which OGR streams. Returns how many features it read."""
    ds, _ = _grid_dataset(grid)
    with zipfile.ZipFile(coastline) as archive:
        names = [n for n in archive.namelist() if n.lower().endswith(".shp")]
    if not names:
        raise SystemExit(f"{coastline.name} holds no shapefile")
    src = ogr.Open(f"/vsizip/{coastline}/{names[0]}")
    layer = src.GetLayer(0)
    layer.SetSpatialFilterRect(BOX[0], BOX[1], BOX[2], BOX[3])
    count = layer.GetFeatureCount()
    gdal.RasterizeLayer(ds, [1], layer, burn_values=[1])
    ds.FlushCache()
    return count


def polygonize(levels, carrier: str, out) -> int:
    """Write each run of one class in `levels` as GeoJSON lines with its
    carrier and level to `out`; return how many.

    Traced a block of BLOCK cells at a time, so a run that spans the state
    is cut on block lines into pieces tippecanoe can clip cheaply: whole, a
    few of them, each with hundreds of thousands of points, kept it tiling
    for hours. The pieces meet on grid lines, so the hatch has no seam."""
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(4326)
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    height, width = levels.shape
    count = 0
    with tempfile.TemporaryDirectory() as tmp:
        fgb = os.path.join(tmp, "levels.fgb")
        vec = ogr.GetDriverByName("FlatGeobuf").CreateDataSource(fgb)
        layer = vec.CreateLayer("levels", srs, ogr.wkbPolygon, ["SPATIAL_INDEX=NO"])
        layer.CreateField(ogr.FieldDefn("level", ogr.OFTInteger))
        for row in range(0, height, BLOCK):
            for col in range(0, width, BLOCK):
                block = np.ascontiguousarray(
                    levels[row : row + BLOCK, col : col + BLOCK]
                )
                if not block.any():
                    continue
                ds = gdal_array.OpenArray(block)
                ds.SetGeoTransform(
                    (
                        BOX[0] + col * GRID_DEG,
                        GRID_DEG,
                        0,
                        BOX[3] - row * GRID_DEG,
                        0,
                        -GRID_DEG,
                    )
                )
                ds.SetProjection(srs.ExportToWkt())
                band = ds.GetRasterBand(1)
                band.SetNoDataValue(0)
                gdal.Polygonize(band, band.GetMaskBand(), layer, 0)
        vec = None
        traced = ogr.Open(fgb)  # held: its layer dies with it
        for feature in traced.GetLayer(0):
            geometry = json.loads(feature.GetGeometryRef().ExportToJson())
            level = LEVELS[feature.GetField("level")]
            out.write(
                json.dumps(
                    {
                        "type": "Feature",
                        "properties": {"carrier": carrier, "level": level},
                        "geometry": geometry,
                    },
                    separators=(",", ":"),
                )
                + "\n"
            )
            count += 1
    return count


def tippecanoe_command(lines: Path, out: Path, tmp: Path) -> List[str]:
    return [
        *["tippecanoe", "--force", "-q", "-o", str(out), "-t", str(tmp)],
        *["-l", SOURCE_LAYER, f"-Z{ZMIN}", f"-z{ZMAX}"],
        *["-n", "Mobile coverage", "-N", CREDIT],
        # No --coalesce or --detect-shared-borders: on this many polygons
        # either one tiles for hours. A simplified edge two levels share can
        # part by a pixel below ZMAX; at ZMAX they are cut as traced.
        # Every cell is some level on land, so a tap always has an answer.
        *["--no-feature-limit", "--no-tile-size-limit"],
        str(lines),
    ]


def build(src: Path, maps: List[dict], coastline: Path, out: Path) -> dict:
    """The archive at `out`, from the downloads of `maps` and the coastline
    zip in `src`; returns each carrier's share of the land at each level."""
    shape = grid_shape()
    print(f"grid {shape[1]} x {shape[0]} at {GRID_DEG}°", flush=True)
    land = np.zeros(shape, np.uint8)
    if burn_land(land, coastline) == 0:
        raise SystemExit("the coastline has no land in the box")
    land_cells = int(land.sum(dtype=np.int64))
    shares: Dict[str, Dict[str, float]] = {}
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=out.parent) as tmp:
        lines = Path(tmp) / "coverage.geojsonl"
        with open(lines, "w", encoding="utf-8") as sink:
            for carrier in NETWORKS:
                grids = {}
                for level in (OUTDOOR, EXT_ANT):
                    grid = np.zeros(shape, np.uint8)
                    for m in maps_for(carrier, level, maps):
                        read = burn_kml(grid, src / file_name(m))
                        print(
                            f"  {carrier} {level}: {file_name(m)}, {read} features",
                            flush=True,
                        )
                        if read == 0:
                            raise SystemExit(f"{file_name(m)} has nothing in the box")
                    grids[level] = grid
                levels = classify(land, grids[OUTDOOR], grids[EXT_ANT])
                del grids
                counts = np.bincount(levels.ravel(), minlength=4)
                shares[carrier] = {
                    name: round(int(counts[key]) / land_cells, 4)
                    for key, name in LEVELS.items()
                }
                print(f"  {carrier}: {shares[carrier]}", flush=True)
                n = polygonize(levels, carrier, sink)
                print(f"  {carrier}: {n} polygons", flush=True)
                del levels
        print(f"tiling → {out}", flush=True)
        subprocess.run(tippecanoe_command(lines, out, Path(tmp)), check=True)
    return shares


# ── Publish ──────────────────────────────────────────────────────────────


def read_state(s3, bucket: str) -> Optional[dict]:
    """The published state, or None. Listed first: S3 answers a GetObject
    for a missing key with AccessDenied unless the caller may list the whole
    bucket, and the task role may list only master/coverage/."""
    listed = s3.list_objects_v2(Bucket=bucket, Prefix=STATE_KEY, MaxKeys=1)
    if listed.get("KeyCount", 0) == 0:
        return None
    return json.loads(s3.get_object(Bucket=bucket, Key=STATE_KEY)["Body"].read())


def source_of(state: dict) -> dict:
    """What decides whether there is anything new: the year and each map's
    id and modified date, not their URLs, which data.gov.au may move."""
    return {
        "year": state["year"],
        "maps": [{"id": m["id"], "modified": m["modified"]} for m in state["maps"]],
    }


def download_release(release: dict, src: Path, fetch: Download = download) -> None:
    """The release's maps into `src` under their URLs' names, and the
    coastline as COASTLINE: what `build` reads."""
    src.mkdir(parents=True, exist_ok=True)
    fetch(COASTLINE_URL, src / COASTLINE)
    for m in release["maps"]:
        print(f"  downloading {file_name(m)}", flush=True)
        fetch(m["url"], src / file_name(m))


def publish(
    bucket: str, s3=None, get: Get = get_json, fetch: Download = download, run=None
) -> None:
    if s3 is None:
        import boto3

        s3 = boto3.client("s3")
    release = latest_maps(get(PACKAGE_URL)["result"]["resources"])
    old = read_state(s3, bucket)
    if old is not None and old.get("source") == source_of(release):
        print(f"unchanged since the published build: {release['year']}")
        return
    print(f"building {release['year']}: {len(release['maps'])} maps", flush=True)
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp)
        download_release(release, src, fetch)
        archive = src / "nsw-coverage.pmtiles"
        shares = (run or build)(src, release["maps"], src / COASTLINE, archive)
        state = {
            "source": source_of(release),
            "year": release["year"],
            "shares": shares,
            "build_date_utc": datetime.now(timezone.utc).isoformat(),
        }
        # The archive before the state, so a failed upload leaves the old
        # state and the next run builds again. Guard: tests/test_coverage.py,
        # test_a_new_release_uploads_the_archive_then_the_state.
        s3.upload_file(
            str(archive),
            bucket,
            ARCHIVE_KEY,
            ExtraArgs={"ContentType": "application/vnd.pmtiles"},
        )
        s3.put_object(
            Bucket=bucket,
            Key=STATE_KEY,
            Body=json.dumps(state, indent=2).encode(),
            ContentType="application/json",
        )
    print(f"published s3://{bucket}/{ARCHIVE_KEY} and the state")


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("publish", help="build the latest release and upload it")
    p.add_argument("--bucket", default=os.environ.get("S3_BUCKET_TOPO"))
    f = sub.add_parser("fetch", help="download the latest release's maps")
    f.add_argument("src", type=Path, help="the directory to download into")
    b = sub.add_parser("build", help="build from `fetch`'s directory")
    b.add_argument("src", type=Path, help="`fetch`'s directory")
    b.add_argument("out", type=Path, help="the .pmtiles to write")
    args = parser.parse_args(argv)
    if args.command == "publish":
        if not args.bucket:
            parser.error("publish needs --bucket or S3_BUCKET_TOPO")
        publish(args.bucket)
        return 0
    release = latest_maps(get_json(PACKAGE_URL)["result"]["resources"])
    if args.command == "fetch":
        print(f"{release['year']}: {len(release['maps'])} maps", flush=True)
        download_release(release, args.src)
    else:
        shares = build(args.src, release["maps"], args.src / COASTLINE, args.out)
        print(json.dumps({"year": release["year"], "shares": shares}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
