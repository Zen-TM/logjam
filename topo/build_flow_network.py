#!/usr/bin/env python3
"""
build_flow_network.py
---------------------
One-off build of the flow network layer: every creek in one or more drainage
basins, as line segments that run from one junction to the next, each
carrying the catchment area (km²) at its two ends.

    build_flow_network.py sheets BASINS
    build_flow_network.py build SRC BASINS WORK OUT.gpkg --extracted "October 2026"

BASINS is a polygon file (GeoPackage, GeoJSON, shapefile; any CRS) with one
feature per drainage basin. SRC holds the 5 m DEM sheets `build_nsw_dem.py
fetch` writes; `sheets` prints the names to fetch for BASINS.

Basins share no water, so each one is built on its own under WORK/<basin>/,
and its stages are skipped once done: a killed run restarts where it stopped.
The last step merges every basin into OUT.gpkg, one layer `flow_network`:

    id                   the segment
    flows_into           the segment it drains into (null at a basin's outlet)
    catchment_start_km2  catchment at its first cell, just below the junction
    catchment_end_km2    catchment at its last cell, just above the next one
    stream_order         Strahler order
    basin                the basin it was built in

Between junctions a creek gains area only from the hillside beside it, so a
point inside a segment reads as a straight-line blend of its two values.

Needs GDAL with its Python bindings, NumPy, Shapely and the `whitebox_tools`
binary (WhiteboxTools) on PATH. Steps 2 to 4 are WhiteboxTools; the rest,
which decides every number in the layer, is this file
(topo/tests/test_flow_network.py).
"""

import argparse
import json
import math
import re
import shutil
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import shapely
from osgeo import gdal, ogr, osr

from build_nsw_dem import INDEX_URL, NODATA, SEAM_FILL_PX, run, sheet_extent

gdal.UseExceptions()
ogr.UseExceptions()

# Australian Albers (GDA94, the sheets' datum). Equal-area, so every cell is
# exactly cell_m² and area is a count of cells; and one grid across the MGA
# 55/56 zone line at 150°E, which runs through the Wolgan and Capertee.
ALBERS = "EPSG:3577"
LAYER = "flow_network"

# ESRI D8 codes, as WhiteboxTools writes them with --esri_pntr: the
# neighbour a cell drains into, as (row step, column step). Rows grow
# southward. 0 (and anything else) means the cell drains nowhere.
ESRI_D8: Dict[int, Tuple[int, int]] = {
    1: (0, 1),  # E
    2: (1, 1),  # SE
    4: (1, 0),  # S
    8: (1, -1),  # SW
    16: (0, -1),  # W
    32: (-1, -1),  # NW
    64: (-1, 0),  # N
    128: (-1, 1),  # NE
}


# ══════════════════════════════════════════════════════════════════════════════
# Pure pieces: everything that decides a number in the layer.
# No GDAL here, so topo/tests/test_flow_network.py runs on any host.
# ══════════════════════════════════════════════════════════════════════════════


def min_cells(min_catchment_km2: float, cell_m: float) -> int:
    """The creek cutoff in cells. It is set in km², so it means the same
    stretch of creek at 5 m and at 20 m."""
    return max(1, math.ceil(min_catchment_km2 * 1e6 / cell_m**2 - 1e-9))


def downstream(idx: np.ndarray, ptr: np.ndarray, nrows: int, ncols: int) -> np.ndarray:
    """For each stream cell, the position in `idx` of the stream cell it
    drains into, or -1 where it drains off the grid, into no-data, or nowhere.

    idx: the stream cells as row * ncols + col, sorted.
    ptr: each one's ESRI D8 code.
    """
    rows, cols = np.divmod(idx, ncols)
    step_r = np.zeros(len(idx), np.int64)
    step_c = np.zeros(len(idx), np.int64)
    flows = np.zeros(len(idx), bool)
    for code, (dr, dc) in ESRI_D8.items():
        hit = ptr == code
        step_r[hit], step_c[hit], flows[hit] = dr, dc, True
    r, c = rows + step_r, cols + step_c
    # Bounds first: off the east edge, col + 1 as a flat index would land on
    # the next row's first cell.
    inside = flows & (r >= 0) & (r < nrows) & (c >= 0) & (c < ncols)
    target = r * ncols + c
    pos = np.searchsorted(idx, target)
    pos_ok = np.minimum(pos, len(idx) - 1)
    found = inside & (pos < len(idx)) & (idx[pos_ok] == target)
    return np.where(found, pos_ok, -1)


@dataclass
class Network:
    """Stream cells grouped into segments ("links").

    cells[offsets[k]:offsets[k + 1]] are link k's cells (positions in the
    stream-cell arrays), upstream to downstream. flows_into[k] is the link
    its water goes to next, or -1.
    """

    cells: np.ndarray
    offsets: np.ndarray
    flows_into: np.ndarray

    def __len__(self) -> int:
        return len(self.offsets) - 1

    @property
    def first(self) -> np.ndarray:
        return self.cells[self.offsets[:-1]]

    @property
    def last(self) -> np.ndarray:
        return self.cells[self.offsets[1:] - 1]


def link(down: np.ndarray) -> Network:
    """Split the stream cells into segments at every junction.

    A segment starts at every cell that does not have exactly one stream cell
    draining into it: none (a creek's source) or several (a junction). The
    junction cell is the FIRST cell of the segment below it, so:
    - a segment's first cell already holds every tributary that joins there;
    - a segment's last cell is the one just above the next junction, and
      holds none of the tributary that joins there.
    Sampling the two ends therefore gives exactly the plan's two values.
    """
    n = len(down)
    inflow_count = np.bincount(down[down >= 0], minlength=n)
    is_start = inflow_count != 1
    starts = np.flatnonzero(is_start)

    # Walk down from each start until the next start. Plain lists: this loop
    # touches every stream cell once, and NumPy scalar indexing is ~10x slower.
    down_l, is_start_l = down.tolist(), is_start.tolist()
    cells: List[int] = []
    offsets = [0]
    for s in starts.tolist():
        cur = s
        while True:
            cells.append(cur)
            nxt = down_l[cur]
            if nxt < 0 or is_start_l[nxt]:
                break
            cur = nxt
        offsets.append(len(cells))

    # Every non-start cell has exactly one cell above it, so each walk reaches
    # its own cells and no others. A cell no walk reached sits on a loop.
    if len(cells) != n:
        raise ValueError(
            f"{n - len(cells)} stream cells are in no segment: the flow directions loop"
        )
    cells_a = np.array(cells, np.int64)
    offsets_a = np.array(offsets, np.int64)
    link_of = np.empty(n, np.int64)
    link_of[cells_a] = np.repeat(np.arange(len(starts)), np.diff(offsets_a))
    below = down[cells_a[offsets_a[1:] - 1]]
    flows_into = np.where(below >= 0, link_of[np.maximum(below, 0)], -1)
    return Network(cells_a, offsets_a, flows_into)


def strahler(flows_into: np.ndarray) -> np.ndarray:
    """Strahler order of each segment: 1 at a source; at a junction, the
    highest order flowing in, plus one if two or more share it. A D8 junction
    can take three creeks at once, hence counting rather than pairing.
    """
    n = len(flows_into)
    into = flows_into.tolist()
    waiting = np.bincount(flows_into[flows_into >= 0], minlength=n).tolist()
    has_inflow = [w > 0 for w in waiting]
    best = [0] * n  # highest order flowing in so far
    best_count = [0] * n  # how many inflows have that order
    order = [0] * n
    # Upstream first (Kahn's algorithm): a segment is ordered once every
    # segment flowing into it is.
    ready = [k for k in range(n) if not has_inflow[k]]
    done = 0
    while ready:
        k = ready.pop()
        done += 1
        if not has_inflow[k]:
            order[k] = 1
        else:
            order[k] = best[k] + (1 if best_count[k] >= 2 else 0)
        d = into[k]
        if d < 0:
            continue
        if order[k] > best[d]:
            best[d], best_count[d] = order[k], 1
        elif order[k] == best[d]:
            best_count[d] += 1
        waiting[d] -= 1
        if waiting[d] == 0:
            ready.append(d)
    if done != n:
        raise ValueError("the segments flow in a loop")
    return np.array(order, np.int64)


def check(net: Network, down: np.ndarray, acc: np.ndarray) -> None:
    """Fail the build rather than write a layer that is quietly wrong."""
    # Accumulation counts every cell above, so it must rise at every step
    # downstream. If it falls, the D8 codes are being read in the wrong
    # directions (an ESRI_D8 entry swapped, or Whitebox's own codes).
    has_down = down >= 0
    if np.any(acc[down[has_down]] <= acc[has_down]):
        raise ValueError("catchment falls going downstream: D8 codes misread")
    # Where creeks meet, the segment below starts with at least what every
    # creek brought (plus the hillside draining straight into the junction).
    into = net.flows_into >= 0
    brought = np.zeros(len(net))
    np.add.at(brought, net.flows_into[into], acc[net.last[into]])
    if np.any(acc[net.first] < brought):
        raise ValueError("a segment starts with less than its tributaries bring")


def keep(flows_into: np.ndarray, kept: np.ndarray) -> np.ndarray:
    """flows_into for only the segments where `kept` is true, renumbered to
    their new positions. A segment that drained into a dropped one now drains
    nowhere (-1)."""
    new_pos = np.full(len(flows_into), -1, np.int64)
    new_pos[kept] = np.arange(int(kept.sum()))
    out = flows_into[kept]
    return np.where(out >= 0, new_pos[np.maximum(out, 0)], -1)


def global_ids(flows_into: np.ndarray, first_id: int) -> Tuple[np.ndarray, np.ndarray]:
    """One basin's segments as layer ids from first_id up, and flows_into in
    the same ids (-1 for none), so ids stay unique when basins are merged."""
    ids = np.arange(len(flows_into), dtype=np.int64) + first_id
    return ids, np.where(flows_into >= 0, flows_into + first_id, -1)


def basin_slug(name: str) -> str:
    """A basin's name as a directory name."""
    return re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower() or "basin"


# ══════════════════════════════════════════════════════════════════════════════
# Basins: the input polygons
# ══════════════════════════════════════════════════════════════════════════════


def srs(code: str) -> osr.SpatialReference:
    ref = osr.SpatialReference()
    ref.SetFromUserInput(code)
    ref.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return ref


def read_basins(
    path: Path, name_field: Optional[str]
) -> List[Tuple[str, ogr.Geometry]]:
    """Each basin's name and polygon, in Albers."""
    ds = ogr.Open(str(path))
    layer = ds.GetLayer(0)
    to_albers = osr.CoordinateTransformation(layer.GetSpatialRef(), srs(ALBERS))
    basins = []
    for feature in layer:
        name = (
            feature.GetField(name_field) if name_field else f"basin-{feature.GetFID()}"
        )
        geom = feature.GetGeometryRef().Clone()
        geom.Transform(to_albers)
        basins.append((str(name), geom))
    names = [basin_slug(n) for n, _ in basins]
    if len(set(names)) != len(names):
        sys.exit("two basins share a name; pick a --name-field that is unique")
    return basins


def lonlat_envelope(geom: ogr.Geometry) -> Tuple[float, float, float, float]:
    """(west, south, east, north) of an Albers geometry."""
    g = geom.Clone()
    g.Transform(osr.CoordinateTransformation(srs(ALBERS), srs("EPSG:4326")))
    west, east, south, north = g.GetEnvelope()
    return west, south, east, north


def sheets(basins_path: Path, name_field: Optional[str]) -> None:
    """Print the 5 m sheets that touch any basin, for build_nsw_dem.py fetch."""
    names = set()
    for _, geom in read_basins(basins_path, name_field):
        west, south, east, north = lonlat_envelope(geom)
        query = urllib.parse.urlencode(
            {
                "where": "1=1",
                "outFields": "dems5mid",
                "returnGeometry": "false",
                "geometry": f"{west},{south},{east},{north}",
                "geometryType": "esriGeometryEnvelope",
                "inSR": "4326",
                "spatialRel": "esriSpatialRelIntersects",
                "f": "json",
            }
        )
        with urllib.request.urlopen(f"{INDEX_URL}?{query}", timeout=60) as response:
            for f in json.load(response)["features"]:
                # The name `build_nsw_dem.py fetch` matches on.
                names.add(f["attributes"]["dems5mid"].split("-")[0])
    print("\n".join(sorted(names)))


# ══════════════════════════════════════════════════════════════════════════════
# Stage bookkeeping
# ══════════════════════════════════════════════════════════════════════════════


def stage(out: Path, label: str) -> Optional[Path]:
    """The path to write a stage to, or None if it is already done.

    A stage writes to `<name>.part<suffix>` and is renamed into place only
    when whole, so a killed run redoes that stage and nothing before it.
    (The suffix stays last: WhiteboxTools picks the format from it.)
    """
    if out.exists():
        print(f"  {label}: done already", flush=True)
        return None
    print(f"  {label}...", flush=True)
    part = out.with_name(f"{out.stem}.part{out.suffix}")
    part.unlink(missing_ok=True)
    return part


def whitebox(tool: str, *args: str) -> None:
    run("whitebox_tools", f"--run={tool}", *args)


# ══════════════════════════════════════════════════════════════════════════════
# Step 1: Clip the DEM sheets to the basin
# ══════════════════════════════════════════════════════════════════════════════


def clip(
    src: Path, basin: ogr.Geometry, work: Path, cell_m: float, buffer_m: float
) -> Path:
    out = work / "1-dem.tif"
    part = stage(out, "1 clip")
    if part is None:
        return out

    # The buffer catches water that the published boundary puts on the wrong
    # side of a divide; segments are cut back to the true basin in step 8.
    buffered = basin.Buffer(buffer_m)
    cutline = work / "cutline.gpkg"
    cutline.unlink(missing_ok=True)
    ds = ogr.GetDriverByName("GPKG").CreateDataSource(str(cutline))
    layer = ds.CreateLayer("cutline", srs(ALBERS), ogr.wkbMultiPolygon)
    feature = ogr.Feature(layer.GetLayerDefn())
    feature.SetGeometry(ogr.ForceToMultiPolygon(buffered))
    layer.CreateFeature(feature)
    ds = None

    west, south, east, north = lonlat_envelope(buffered)
    picked = []
    for sheet in sorted(src.glob("*.tif")):
        w, s, e, n = sheet_extent(sheet)
        if w < east and e > west and s < north and n > south:
            picked.append(str(sheet))
    if not picked:
        sys.exit(f"no sheet in {src} touches this basin; run `sheets` and fetch them")
    print(f"    {len(picked)} sheet(s)", flush=True)

    # Straight from the sheets, not a VRT: the sheets are in two MGA zones and
    # a VRT takes one. Not from nsw-5m.pmtiles either: that copy is web
    # mercator and rounded to quarter-metres.
    gdal.Warp(
        str(part),
        picked,
        format="GTiff",
        dstSRS=ALBERS,
        xRes=cell_m,
        yRes=cell_m,
        # Snap to a fixed grid, so every basin's cells line up.
        targetAlignedPixels=True,
        cutlineDSName=str(cutline),
        cropToCutline=True,
        # Averaging when coarsening (the 20 m test); bilinear at 5 m.
        resampleAlg="average" if cell_m > 5 else "bilinear",
        srcNodata=NODATA,
        dstNodata=NODATA,
        outputType=gdal.GDT_Float32,
        multithread=True,
        warpMemoryLimit=2048,
        # Plain DEFLATE: WhiteboxTools 2.4 reads neither the ZSTD the sheets
        # use nor a floating-point predictor ("PREDICTOR=3").
        creationOptions=["COMPRESS=DEFLATE", "TILED=YES", "BIGTIFF=YES"],
    )
    # Neighbouring sheets don't quite meet (build_nsw_dem.build_block): a
    # strip of no-data two or three cells wide along every sheet edge. Water
    # can't cross no-data, so unfilled, every seam would cut every creek.
    ds = gdal.Open(str(part), gdal.GA_Update)
    gdal.FillNodata(ds.GetRasterBand(1), None, SEAM_FILL_PX, 0)
    ds = None
    part.rename(out)
    return out


# ══════════════════════════════════════════════════════════════════════════════
# Step 2: Breach depressions (WhiteboxTools)
# ══════════════════════════════════════════════════════════════════════════════


def breach(dem: Path, work: Path, cell_m: float, breach_max_m: float) -> Path:
    out = work / "2-breached.tif"
    part = stage(out, "2 breach depressions")
    if part is None:
        return out
    # A road embankment is a dam in a bare-earth DEM: the culvert under it
    # isn't in the data. Breaching cuts a channel through it, as the water
    # does; filling would turn the creek above it into a flat lake, across
    # which the flow lines wander. --fill catches the few pits a breach of at
    # most breach_max_m can't drain, so every cell drains somewhere.
    whitebox(
        "BreachDepressionsLeastCost",
        f"--dem={dem}",
        f"--output={part}",
        f"--dist={max(1, round(breach_max_m / cell_m))}",
        "--fill",
    )
    part.rename(out)
    return out


# ══════════════════════════════════════════════════════════════════════════════
# Step 3: D8 flow direction (WhiteboxTools)
# ══════════════════════════════════════════════════════════════════════════════


def flow_direction(breached: Path, work: Path) -> Path:
    # Kept after the build: canyon regions (Step 4 of the plan) trace a
    # catchment's outline from this raster.
    out = work / "3-d8.tif"
    part = stage(out, "3 D8 flow direction")
    if part is None:
        return out
    # Each cell points at its steepest downhill neighbour, as an ESRI code
    # (ESRI_D8). check() fails the build if they are read the wrong way.
    whitebox("D8Pointer", f"--dem={breached}", f"--output={part}", "--esri_pntr")
    part.rename(out)
    return out


# ══════════════════════════════════════════════════════════════════════════════
# Step 4: D8 flow accumulation (WhiteboxTools)
# ══════════════════════════════════════════════════════════════════════════════


def flow_accumulation(d8: Path, work: Path) -> Path:
    out = work / "4-accumulation.tif"
    part = stage(out, "4 D8 flow accumulation")
    if part is None:
        return out
    # Each cell: how many cells drain through it. Times cell_m² is its
    # catchment area.
    whitebox(
        "D8FlowAccumulation",
        f"--input={d8}",
        f"--output={part}",
        "--pntr",
        "--esri_pntr",
        "--out_type=cells",
    )
    part.rename(out)
    return out


# ══════════════════════════════════════════════════════════════════════════════
# Step 5: Threshold to creek cells
# ══════════════════════════════════════════════════════════════════════════════


def stream_cells(d8: Path, acc: Path, threshold: int):
    """Every cell draining at least `threshold` cells, read a strip of rows at
    a time so the whole grid is never in memory at once.

    Returns (idx, ptr, acc, grid): flat cell index (row * ncols + col,
    sorted), D8 code, accumulation, and (nrows, ncols, geotransform).
    """
    d8_ds, acc_ds = gdal.Open(str(d8)), gdal.Open(str(acc))
    ncols, nrows = acc_ds.RasterXSize, acc_ds.RasterYSize
    acc_band = acc_ds.GetRasterBand(1)
    nodata = acc_band.GetNoDataValue()
    strip = 1024
    parts = []
    for y0 in range(0, nrows, strip):
        h = min(strip, nrows - y0)
        a = acc_band.ReadAsArray(0, y0, ncols, h).astype(np.float64)
        hit = a >= threshold
        if nodata is not None:
            hit &= a != nodata
        r, c = np.nonzero(hit)  # row-major, so idx comes out sorted
        if len(r) == 0:
            continue
        p = d8_ds.GetRasterBand(1).ReadAsArray(0, y0, ncols, h)
        parts.append(
            ((r + y0).astype(np.int64) * ncols + c, p[r, c].astype(np.int64), a[r, c])
        )
    if not parts:
        sys.exit("no cell drains enough to count as a creek; is the basin empty?")
    idx, ptr, acc_v = (np.concatenate(x) for x in zip(*parts))
    return idx, ptr, acc_v, (nrows, ncols, acc_ds.GetGeoTransform())


# ══════════════════════════════════════════════════════════════════════════════
# Steps 6 to 8: segments, areas and order, lines; written per basin
# ══════════════════════════════════════════════════════════════════════════════


def segments(
    d8: Path,
    acc: Path,
    basin: ogr.Geometry,
    work: Path,
    cell_m: float,
    min_catchment_km2: float,
) -> Path:
    out = work / "segments.gpkg"
    part = stage(out, "5-8 creeks, segments, areas, lines")
    if part is None:
        return out

    # ── Step 5: threshold ────────────────────────────────────────────────────
    idx, ptr, acc_v, (nrows, ncols, gt) = stream_cells(
        d8, acc, min_cells(min_catchment_km2, cell_m)
    )
    print(f"    {len(idx):,} creek cells", flush=True)

    # ── Step 6: split at junctions, link each segment to the one below ───────
    down = downstream(idx, ptr, nrows, ncols)
    net = link(down)
    check(net, down, acc_v)
    print(f"    {len(net):,} segments", flush=True)

    # ── Step 7: sample the two ends, and the stream order ────────────────────
    km2_per_cell = cell_m**2 / 1e6
    start_km2 = acc_v[net.first] * km2_per_cell
    end_km2 = acc_v[net.last] * km2_per_cell
    order = strahler(net.flows_into)

    # ── Step 8: lines, cut to the basin, simplified ──────────────────────────
    # Cell centres in Albers. Each line also takes the first cell of the
    # segment below, so segments meet at their junctions on the map.
    rows, cols = np.divmod(idx, ncols)
    x = gt[0] + (cols + 0.5) * gt[1]
    y = gt[3] + (rows + 0.5) * gt[5]
    below = down[net.last]
    ext_counts = np.diff(net.offsets) + (below >= 0)
    ext_cells = np.empty(int(ext_counts.sum()), np.int64)
    ext_starts = np.concatenate([[0], np.cumsum(ext_counts)[:-1]])
    for k in range(len(net)):  # per segment, not per cell: cheap
        a, b = net.offsets[k], net.offsets[k + 1]
        s = ext_starts[k]
        ext_cells[s : s + b - a] = net.cells[a:b]
        if below[k] >= 0:
            ext_cells[s + b - a] = below[k]
    # A one-cell segment at the network's very end has no second point.
    ext_counts_ok = ext_counts >= 2
    point_ok = np.repeat(ext_counts_ok, ext_counts)
    lines = np.full(len(net), None, object)
    shapely.linestrings(
        np.column_stack([x[ext_cells], y[ext_cells]])[point_ok],
        indices=np.repeat(np.arange(len(net)), ext_counts)[point_ok],
        out=lines,
    )

    # Keep a segment only if its last cell is in the basin itself, not the
    # buffer: inside the basin, everything upstream is inside too, so its
    # catchment is whole. Outside, it may run off the clipped grid.
    basin_shape = shapely.from_wkb(bytes(basin.ExportToWkb()))
    shapely.prepare(basin_shape)
    last = net.last
    kept = ext_counts_ok & shapely.contains_xy(basin_shape, x[last], y[last])
    flows_into = keep(net.flows_into, kept)
    # Douglas–Peucker keeps both ends, so segments still meet. Half a cell
    # drops the D8 staircase and nothing a map would show.
    lines = shapely.simplify(lines[kept], cell_m / 2)
    print(f"    {int(kept.sum()):,} segments inside the basin", flush=True)

    write_segments(
        part,
        lines,
        flows_into,
        start_km2[kept],
        end_km2[kept],
        order[kept],
    )
    part.rename(out)
    return out


def write_segments(path, lines, flows_into, start_km2, end_km2, order) -> None:
    """One basin's segments, ids 1..n, still in Albers (the merge reprojects)."""
    ds = ogr.GetDriverByName("GPKG").CreateDataSource(str(path))
    layer = ds.CreateLayer(LAYER, srs(ALBERS), ogr.wkbLineString)
    for name, kind in (
        ("id", ogr.OFTInteger64),
        ("flows_into", ogr.OFTInteger64),
        ("catchment_start_km2", ogr.OFTReal),
        ("catchment_end_km2", ogr.OFTReal),
        ("stream_order", ogr.OFTInteger),
    ):
        layer.CreateField(ogr.FieldDefn(name, kind))
    ids, into = global_ids(flows_into, 1)
    wkb = shapely.to_wkb(lines)
    layer.StartTransaction()
    for k in range(len(ids)):
        f = ogr.Feature(layer.GetLayerDefn())
        f.SetField("id", int(ids[k]))
        if into[k] >= 0:
            f.SetField("flows_into", int(into[k]))
        f.SetField("catchment_start_km2", float(start_km2[k]))
        f.SetField("catchment_end_km2", float(end_km2[k]))
        f.SetField("stream_order", int(order[k]))
        f.SetGeometry(ogr.CreateGeometryFromWkb(wkb[k]))
        layer.CreateFeature(f)
    layer.CommitTransaction()
    ds = None


# ══════════════════════════════════════════════════════════════════════════════
# Merge: every basin into one layer
# ══════════════════════════════════════════════════════════════════════════════


def merge(parts: List[Tuple[str, Path]], out: Path, extracted: str) -> None:
    """Every basin's segments in one layer, ids unique across basins, in
    WGS84. Redone each run: it is fast, and a basin may have been added."""
    print("merge", flush=True)
    part = out.with_name(f"{out.stem}.part{out.suffix}")
    part.unlink(missing_ok=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    ds = ogr.GetDriverByName("GPKG").CreateDataSource(str(part))
    wgs84 = srs("EPSG:4326")
    layer = ds.CreateLayer(
        LAYER,
        wgs84,
        ogr.wkbLineString,
        # The licence asks a derived product to say when the data was taken
        # (docs/decisions/0031-nsw-heights-come-from-the-spatial-services-5m-dem.md).
        options=[
            "DESCRIPTION=Creek segments and catchment areas derived from the NSW"
            " 5 m Digital Elevation Model, © State of New South Wales (Spatial"
            f" Services), extracted {extracted}. CC BY 3.0 AU."
        ],
    )
    for name, kind in (
        ("id", ogr.OFTInteger64),
        ("flows_into", ogr.OFTInteger64),
        ("catchment_start_km2", ogr.OFTReal),
        ("catchment_end_km2", ogr.OFTReal),
        ("stream_order", ogr.OFTInteger),
        ("basin", ogr.OFTString),
    ):
        layer.CreateField(ogr.FieldDefn(name, kind))
    to_wgs84 = osr.CoordinateTransformation(srs(ALBERS), wgs84)

    next_id = 1
    layer.StartTransaction()
    for name, path in parts:
        # Held in a name: a layer of a dataset Python has freed crashes.
        src_ds = ogr.Open(str(path))
        # In id order, so position k is local id k + 1.
        features = sorted(src_ds.GetLayer(0), key=lambda f: f.GetField("id"))
        local_into = np.array(
            [
                -1 if f.GetField("flows_into") is None else f.GetField("flows_into") - 1
                for f in features
            ],
            np.int64,
        )
        ids, into = global_ids(local_into, next_id)
        for f, new_id, new_into in zip(features, ids, into):
            g = ogr.Feature(layer.GetLayerDefn())
            g.SetField("id", int(new_id))
            if new_into >= 0:
                g.SetField("flows_into", int(new_into))
            for field in ("catchment_start_km2", "catchment_end_km2", "stream_order"):
                g.SetField(field, f.GetField(field))
            g.SetField("basin", name)
            geom = f.GetGeometryRef().Clone()
            geom.Transform(to_wgs84)
            g.SetGeometry(geom)
            layer.CreateFeature(g)
        print(f"  {name}: {len(features):,} segments", flush=True)
        next_id += len(features)
    layer.CommitTransaction()
    ds = None
    part.rename(out)


# ══════════════════════════════════════════════════════════════════════════════
# Build: steps 1 to 8 for each basin, then the merge
# ══════════════════════════════════════════════════════════════════════════════


def build(args: argparse.Namespace) -> None:
    if not shutil.which("whitebox_tools"):
        sys.exit("build needs the `whitebox_tools` binary (WhiteboxTools) on PATH")
    parts = []
    for name, basin in read_basins(args.basins, args.name_field):
        print(name, flush=True)
        work = args.work / basin_slug(name)
        work.mkdir(parents=True, exist_ok=True)
        dem = clip(args.src, basin, work, args.cell_m, args.buffer_m)
        breached = breach(dem, work, args.cell_m, args.breach_max_m)
        d8 = flow_direction(breached, work)
        acc = flow_accumulation(d8, work)
        parts.append(
            (name, segments(d8, acc, basin, work, args.cell_m, args.min_catchment_km2))
        )
    merge(parts, args.out, args.extracted)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("sheets", help="print the DEM sheets the basins need")
    p.add_argument("basins", type=Path)
    p.add_argument("--name-field")

    p = sub.add_parser("build", help="build the flow network layer")
    p.add_argument("src", type=Path, help="the DEM sheets (build_nsw_dem.py fetch)")
    p.add_argument("basins", type=Path, help="basin polygons, one feature each")
    p.add_argument("work", type=Path, help="working files, one directory per basin")
    p.add_argument("out", type=Path, help="the flow network GeoPackage")
    p.add_argument(
        "--extracted",
        required=True,
        help='when the sheets were downloaded, e.g. "October 2026"',
    )
    p.add_argument(
        "--name-field", help="the basins' name attribute (default: feature id)"
    )
    p.add_argument("--cell-m", type=float, default=5.0, help="grid cell size (m)")
    p.add_argument(
        "--min-catchment-km2",
        type=float,
        # Around Katoomba, two-thirds of the creeks NSW Hydrography maps (the
        # SIX topo map's creeks) start below 0.02 km², half below 0.01. 0.02
        # draws most of them without D8 cutting creeks down plain hillsides.
        default=0.02,
        help="the catchment at which a creek starts",
    )
    p.add_argument(
        "--buffer-m", type=float, default=2000.0, help="extra DEM around each basin"
    )
    p.add_argument(
        "--breach-max-m",
        type=float,
        default=500.0,
        help="the longest channel a breach may cut",
    )
    args = parser.parse_args()
    if args.command == "sheets":
        sheets(args.basins, args.name_field)
    else:
        build(args)


if __name__ == "__main__":
    main()
