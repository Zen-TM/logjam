"""
area_export.py
--------------
An export of an area: the statewide terrain over a box, as raw data for a GIS
(GeoTIFF, a zip of one file per layer with CREDITS.txt, or one GeoPackage), or
as a styled map for an offline map app (one MBTiles, `render_mbtiles`).

Everything is read from the published archives, never the source sheets, so a
file holds the numbers the map, the slope readout and Logjam GPS read:

- heights: `nsw-5m.pmtiles` at z15, Float32 metres;
- slope: `nsw-5m-slope.pmtiles` at z15, whole degrees (ADR 0039);
- hillshade: `gdaldem hillshade` over the exported heights;
- contours: the statewide build's own recipe (heights averaged to 10 m, a line
  every 10 m) run over the exported heights, so the lines match the map's and
  come out whole instead of cut at every tile edge.

Rasters are warped once into GDA2020 / MGA, the zone of the box's centre, at
5 m: in web mercator a GIS computing slope from the heights would be off by
1/cos(latitude). The z15 tiles are first written into one tiled GeoTIFF on
disk, so memory stays flat however large the box: GDAL warps it in chunks.

Inside a sharpened area the user may read (ADR 0040), the API names the area
and its place in the router's order (`sourceJobIds`, decided at submit). A
GeoTIFF or GeoPackage adds the area's own rasters, at its own cell, cut to its
survey's footprint: the 5 m files stay whole, and the area's sit beside them.
An MBTiles draws each tile from the one archive the map would
(`tile_archive`), down to the area's zmax.

An MBTiles stays in web mercator, where its tiles are. Its contours are the
statewide contour archive's own lines, the ones the map draws, read a tile at
a time: recut from the heights, a 100 km box is ~60 M vertices, and the
renderer would hold them all in each process.
"""

from __future__ import annotations

import gzip
import io
import json
import logging
import math
import re
import shutil
import subprocess
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple, Union

import numpy as np
from osgeo import gdal, osr
from PIL import Image
from pmtiles.reader import Reader
from pmtiles.tile import (
    deserialize_directory,
    deserialize_header,
    find_tile,
    zxy_to_tileid,
)

from build_nsw_dem import (
    CONTOUR_CELL_M,
    CONTOUR_INTERVAL_M,
    CONTOUR_KEY,
    CONTOUR_LAYER,
    CONTOUR_MAJOR_M,
    CONTOUR_ZOOMS,
    HALF_WORLD_M,
    HEIGHT_KEY,
    NODATA,
    SLOPE_KEY,
    ZMAX,
    decode_terrarium,
    lonlat_to_tile,
    tile_bounds_3857,
)
from pipeline import (
    COMPOSITE_LAYER_ORDER,
    HILLSHADE_DEFAULTS,
    TILE_SIZE,
    _parse_rgba_hex,
    create_mbtiles,
    finalise_bounds,
    insert_tile,
    render_contours_tile,
    tile_to_bbox,
    tiles_for_bbox,
)
from renderers.tile_compose import (
    _composite_workers,
    _vector_style_to_render_settings,
)

gdal.UseExceptions()
log = logging.getLogger("export_worker.area")

# shared/src/areaExport.ts declares these too (tests/test_area_export.py).
LAYERS = ("heights", "slope", "hillshade", "contours")
FORMATS = ("geotiff", "gpkg", "mbtiles")
# A GeoTIFF is rasters only: contours go in a GeoPackage. An MBTiles is a
# picture of the map, with no heights to draw.
LAYERS_BY_FORMAT = {
    "geotiff": ("heights", "slope", "hillshade"),
    "gpkg": LAYERS,
    "mbtiles": ("slope", "hillshade", "contours"),
}
# An MBTiles from where the box is a few tiles to past the 5 m terrain's z15,
# the zooms an offline map app shows a trail map at.
MBTILES_ZOOMS = (11, 16)
CONTOUR_ZMAX = max(zmax for _, zmax in CONTOUR_ZOOMS.values())
CELL_M = 5
SLOPE_NODATA = 255
# An area's cell at its deepest zoom: ~2 m at z16 and ~1 m at z17 at NSW's
# latitudes, the cells topo/sharpen.py `zoom_for_cell` makes each zoom from
# (tests/test_area_export.py `AreaCells`).
AREA_CELL_M = {16: 2, 17: 1}
# shared/src/sharpen.ts TERRAIN_ROUTED_FROM (tests/test_area_export.py).
ROUTED_FROM = {"heights": 15, "slope": 15, "contours": 14}
# Tiles fetched and decoded at once, and how many are handed out together: a
# decoded tile is 256 KB of floats, so at most a chunk of them is ever held.
FETCH_THREADS = 16
FETCH_CHUNK = 256


class AreaExportError(Exception):
    """An area export that failed; the message is for the log only."""


class AreaOutsideNsw(AreaExportError):
    """No statewide tiles in the box: the API's coverage rectangle is wider
    than NSW, so a box in Victoria or Queensland gets this far. `SENTENCE` is
    what the owner reads, the API's AREA_EXPORT_OUTSIDE_NSW
    (tests/test_area_export.py)."""

    SENTENCE = (
        "That area is outside NSW, where the statewide terrain is. Choose an "
        "area in NSW."
    )


Bbox = Tuple[float, float, float, float]  # west, south, east, north (degrees)
GetBytes = Callable[[int, int], bytes]


def mga_epsg(lon: float) -> int:
    """GDA2020 / MGA for the zone a longitude falls in (zone 55 is EPSG:7855)."""
    return 7800 + int((lon + 180) // 6) + 1


def plan(layers: Sequence[str]) -> Dict[str, bool]:
    """Which steps a set of layers needs: hillshade and contours are made
    from the heights, so asking for either reads the heights archive."""
    wanted = set(layers)
    return {
        "heights": bool(wanted & {"heights", "hillshade", "contours"}),
        "slope": "slope" in wanted,
        "hillshade": "hillshade" in wanted,
        "contours": "contours" in wanted,
    }


def _listed(layers: Sequence[str]) -> str:
    names = [l for l in LAYERS if l in layers]
    listed = names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"
    return f"{listed[0].upper()}{listed[1:]}"


def credit_line(layers: Sequence[str], attribution: str) -> str:
    """One credit for every layer in the file, from the heights archive's own
    attribution ("Derived from the NSW 5 m … extracted October 2026 …"): each
    layer is derived from the same DEM, and the archive knows its extract date.
    """
    return f"{_listed(layers)}: {attribution[0].lower()}{attribution[1:]}"


def area_credit_line(layers: Sequence[str], credit: str) -> str:
    """An area's survey credit ("Elevation: derived from a LiDAR survey …")
    for the layers drawn from it, worded as the GeoPDF words it
    (shared/src/terrain.ts `terrainCredit`)."""
    return re.sub(r"^Elevation", _listed(layers), credit)


@dataclass(frozen=True)
class Area:
    """A sharpened area an export reads (shared/src/sharpen.ts `SharpenedArea`)
    with its archive keys and its survey's footprint."""

    id: str
    zmax: int
    tiles15: Tuple[int, int, int, int]
    coverage: Bbox
    credit: str
    keys: Dict[str, Optional[str]]
    footprint: Optional[dict]

    @property
    def contours(self) -> bool:
        return self.keys.get("contours") is not None


def area_from(row: dict) -> Optional[Area]:
    """An area from a completed job's row, as the API's `sharpenedAreaFrom`
    reads it, or None for a row that is not one. Each key must lie under the
    job's own outputs, so a bad row can never point the worker at another
    object (tests/test_area_export.py `AreaFrom`)."""
    r = row.get("sharpen")
    if isinstance(r, str):
        r = json.loads(r)
    if not isinstance(r, dict) or r.get("v") != 1:
        return None
    keys = r.get("keys") if isinstance(r.get("keys"), dict) else {}

    def own(key: object) -> bool:
        return isinstance(key, str) and key.startswith(f"outputs/{row['id']}/")

    tiles15, coverage = r.get("tiles15"), r.get("coverage")
    if (
        r.get("zmax") not in AREA_CELL_M
        or not (isinstance(tiles15, list) and len(tiles15) == 4)
        or not all(isinstance(t, int) for t in tiles15)
        or not (isinstance(coverage, list) and len(coverage) == 4)
        or not all(isinstance(c, (int, float)) for c in coverage)
        or not isinstance(r.get("credit"), str)
        or not own(keys.get("heights"))
        or not own(keys.get("slope"))
        or (keys.get("contours") is not None and not own(keys.get("contours")))
    ):
        return None
    footprint = row.get("footprint")
    if isinstance(footprint, str):
        footprint = json.loads(footprint)
    return Area(
        id=row["id"],
        zmax=r["zmax"],
        tiles15=tuple(tiles15),
        coverage=tuple(coverage),
        credit=r["credit"],
        keys={k: keys.get(k) for k in ("heights", "slope", "contours")},
        footprint=footprint if isinstance(footprint, dict) else None,
    )


def tile_archive(
    areas: Sequence[Area], layer: str, z: int, x: int, y: int
) -> Union[str, Area]:
    """`terrainTileArchive` (shared/src/sharpen.ts) over areas already in the
    router's order, which the API gave them: the one archive a tile is read
    from, "statewide", or "absent" (tests/test_area_export.py `TileArchive`
    holds the same edges as sharpen.test.ts)."""
    start = ROUTED_FROM[layer]
    if z < start:
        return "statewide"
    up, shift = 15 - start, z - start
    for area in areas:
        if layer == "contours" and not area.contours:
            continue
        x0, y0, x1, y1 = (t >> up for t in area.tiles15)
        if x0 <= x >> shift <= x1 and y0 <= y >> shift <= y1:
            if layer == "contours":
                return area
            return area if z <= area.zmax else "absent"
    if layer == "contours":
        return "statewide"
    return "statewide" if z == start else "absent"


def tile_range(bbox: Bbox, zoom: int) -> Tuple[int, int, int, int]:
    """(x0, y0, x1, y1), inclusive, of the tiles covering a box."""
    west, south, east, north = bbox
    x0, y0 = lonlat_to_tile(west, north, zoom)
    x1, y1 = lonlat_to_tile(east, south, zoom)
    return x0, y0, x1, y1


def mga_extent(bbox: Bbox, epsg: int, cell: int = CELL_M) -> Tuple[Bbox, Bbox]:
    """The MGA rectangle a box is warped to, on the cell's grid, and that
    rectangle's own lon/lat bounds. The box is rotated in MGA, so the rectangle
    reaches past it at the corners: the mosaic covers the lon/lat bounds, or
    those corners come out no-data."""
    wgs84, mga = osr.SpatialReference(), osr.SpatialReference()
    wgs84.ImportFromEPSG(4326)
    mga.ImportFromEPSG(epsg)
    for srs in (wgs84, mga):
        srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    xmin, ymin, xmax, ymax = osr.CoordinateTransformation(wgs84, mga).TransformBounds(
        *bbox, 21
    )
    rect = (
        math.floor(xmin / cell) * cell,
        math.floor(ymin / cell) * cell,
        math.ceil(xmax / cell) * cell,
        math.ceil(ymax / cell) * cell,
    )
    around = osr.CoordinateTransformation(mga, wgs84).TransformBounds(*rect, 21)
    return rect, tuple(around)


def s3_ranges(s3, bucket: str, key: str) -> GetBytes:
    def get_bytes(offset: int, length: int) -> bytes:
        return s3.get_object(
            Bucket=bucket, Key=key, Range=f"bytes={offset}-{offset + length - 1}"
        )["Body"].read()

    return get_bytes


class Archive:
    """A PMTiles archive read by byte ranges. `pmtiles.Reader.get` reads and
    parses the header and each directory again for every tile, in Python,
    which held a 150 km box past an hour; here each is parsed once."""

    def __init__(self, get_bytes: GetBytes):
        self._get_bytes = get_bytes
        self._header = deserialize_header(get_bytes(0, 127))
        # A chunk of tiles walks a few rows of the box, a few leaves each.
        self._directory = lru_cache(maxsize=128)(
            lambda offset, length: deserialize_directory(get_bytes(offset, length))
        )

    def metadata(self) -> dict:
        return Reader(self._get_bytes).metadata()

    def get(self, z: int, x: int, y: int) -> Optional[bytes]:
        tile_id = zxy_to_tileid(z, x, y)
        header = self._header
        offset, length = header["root_offset"], header["root_length"]
        for _ in range(4):  # the format's deepest directory
            entry = find_tile(self._directory(offset, length), tile_id)
            if entry is None:
                return None
            if entry.run_length > 0:
                return self._get_bytes(
                    header["tile_data_offset"] + entry.offset, entry.length
                )
            offset = header["leaf_directory_offset"] + entry.offset
            length = entry.length
        return None


def write_mosaic(
    reader: Archive,
    bbox: Bbox,
    path: Path,
    kind: str,
    attribution: str,
    zoom: int = ZMAX,
) -> None:
    """The archive's tiles at `zoom` (z15 statewide, an area's zmax) over the
    box as one tiled web-mercator GeoTIFF:
    heights as Float32 (no-data NODATA), slope as Byte degrees (no-data 255).
    Tiles are fetched and decoded in threads and written by this one, a chunk
    at a time."""
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
    if found == 0:
        raise AreaOutsideNsw(f"no {kind} tiles in the box")


def run(*command: str, stderr_in_error: bool = True) -> None:
    """Raises with GDAL's stderr for the log. A warp with a cutline drops it
    (`warp_to_mga` passes `stderr_in_error=False`): GDAL quotes a bad
    geometry's coordinates there, and the log never carries a place
    (tests/test_area_export.py `CutlineErrors`)."""
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        detail = f": {result.stderr.strip()}" if stderr_in_error else ""
        raise AreaExportError(f"{command[0]} failed{detail}")


def warp_to_mga(
    source: Path,
    out: Path,
    rect: Bbox,
    epsg: int,
    resampling: str,
    cell: int = CELL_M,
    cutline: Optional[Path] = None,
) -> None:
    """`cutline` clears what lies outside it: an area's 5 m fill around its
    survey."""
    cut = ("-cutline", str(cutline)) if cutline else ()
    run(
        "gdalwarp", "-q", "-overwrite",
        "-t_srs", f"EPSG:{epsg}",
        "-te", *map(str, rect),
        "-tr", str(cell), str(cell),
        *cut,
        "-r", resampling,
        "-multi", "-wo", "NUM_THREADS=ALL_CPUS", "-wm", "512",
        "-of", "COG",
        "-co", "COMPRESS=DEFLATE", "-co", "PREDICTOR=YES",
        "-co", "BIGTIFF=IF_SAFER", "-co", "NUM_THREADS=ALL_CPUS",
        str(source), str(out),
        stderr_in_error=cutline is None,
    )  # fmt: skip


@dataclass
class Made:
    rasters: Dict[str, Path]
    contours: Optional[Path]
    credit: str
    # Where the files go in the download: "" for the statewide 5 m ones,
    # "sharpened-1" and on for each area's.
    name: str = ""
    # Its line in CREDITS.txt, when not `credit`: an area's own, since the
    # 5 m line its files also carry is listed once already.
    listed: Optional[str] = None


def make_layers(
    archives: Dict[str, GetBytes],
    bbox: Bbox,
    layers: Sequence[str],
    work: Path,
    *,
    epsg: Optional[int] = None,
    zoom: int = ZMAX,
    cell: int = CELL_M,
    cutline: Optional[Path] = None,
    credit: Optional[str] = None,
) -> Made:
    """Every requested layer as a file in MGA, in `work`: the statewide 5 m
    ones by default, or an area's at its zoom and cell, cut to its survey."""
    steps = plan(layers)
    if epsg is None:
        epsg = mga_epsg((bbox[0] + bbox[2]) / 2)
    heights_reader = Archive(archives["heights"])
    if credit is None:
        attribution = heights_reader.metadata().get("attribution")
        if not attribution:
            raise AreaExportError("the heights archive carries no attribution")
        credit = credit_line(layers, attribution)
    rect, around = mga_extent(bbox, epsg, cell)
    rasters: Dict[str, Path] = {}

    if steps["heights"]:
        mosaic = work / "heights-3857.tif"
        write_mosaic(heights_reader, around, mosaic, "heights", credit, zoom)
        rasters["heights"] = work / "heights.tif"
        warp_to_mga(mosaic, rasters["heights"], rect, epsg, "bilinear", cell, cutline)
        mosaic.unlink()
    if steps["slope"]:
        mosaic = work / "slope-3857.tif"
        write_mosaic(Archive(archives["slope"]), around, mosaic, "slope", credit, zoom)
        rasters["slope"] = work / "slope.tif"
        warp_to_mga(mosaic, rasters["slope"], rect, epsg, "near", cell, cutline)
        mosaic.unlink()
    if steps["hillshade"]:
        shade = work / "hillshade-raw.tif"
        rasters["hillshade"] = work / "hillshade.tif"
        run(
            "gdaldem", "hillshade", "-q", "-compute_edges",
            "-az", "315", "-alt", "45",
            "-co", "TILED=YES", "-co", "COMPRESS=DEFLATE", "-co", "BIGTIFF=IF_SAFER",
            str(rasters["heights"]), str(shade),
        )  # fmt: skip
        # A COG cannot be reopened to add the credit, so it goes in on the copy.
        run(
            "gdal_translate", "-q", "-of", "COG",
            "-mo", f"TIFFTAG_COPYRIGHT={credit}",
            "-co", "COMPRESS=DEFLATE", "-co", "PREDICTOR=YES",
            "-co", "BIGTIFF=IF_SAFER", "-co", "NUM_THREADS=ALL_CPUS",
            str(shade), str(rasters["hillshade"]),
        )  # fmt: skip
        shade.unlink()
    contours = None
    if steps["contours"]:
        smooth = work / "heights-10m.tif"
        contours = work / "contours.gpkg"
        # The statewide build's recipe (build_nsw_dem.contours), which an
        # area's contours follow too: averaged to 10 m first, or the lines
        # follow every knob of the grid.
        smooth_cell = str(CONTOUR_CELL_M)
        run(
            "gdalwarp", "-q", "-overwrite", "-tr", smooth_cell, smooth_cell,
            "-r", "average",
            "-co", "COMPRESS=DEFLATE", "-co", "BIGTIFF=IF_SAFER",
            str(rasters["heights"]), str(smooth),
        )  # fmt: skip
        run(
            "gdal_contour", "-q", "-a", "elev", "-i", str(CONTOUR_INTERVAL_M),
            "-snodata", str(NODATA), "-f", "GPKG", "-nln", "contours",
            "-lco", f"DESCRIPTION={credit}",
            str(smooth), str(contours),
        )  # fmt: skip
        smooth.unlink()
    for name in [n for n in rasters if n not in layers]:
        rasters.pop(name).unlink()
    return Made(rasters=rasters, contours=contours, credit=credit)


DISCLAIMER = (
    "This is data derived from someone else's survey, and it may be wrong or "
    "out of date. Don't rely on it in place of your own navigation, judgement "
    "or rescue planning."
)


def package(mades: Sequence[Made], fmt: str, work: Path) -> Path:
    """The file the user downloads: the statewide files first, then each
    area's, named for it ("sharpened-1/heights.tif", "sharpened_1_heights")."""
    # Two areas extracted in the same month carry the same credit: once each.
    credits = "\n".join(dict.fromkeys(made.listed or made.credit for made in mades))
    if fmt == "geotiff":
        out = work / "logjam-area.zip"
        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_STORED) as zf:
            # The rasters are compressed already.
            for made in mades:
                folder = f"{made.name}/" if made.name else ""
                for name, path in made.rasters.items():
                    zf.write(path, arcname=f"{folder}{name}.tif")
                    path.unlink()  # one copy of each raster on disk at a time
            zf.writestr("CREDITS.txt", f"{credits}\n\n{DISCLAIMER}\n")
        return out
    if fmt == "gpkg":
        out = work / "logjam-area.gpkg"
        for made in mades:
            prefix = f"{made.name.replace('-', '_')}_" if made.name else ""
            if made.contours is not None:
                if not out.exists() and not prefix:
                    made.contours.rename(out)
                else:
                    run(
                        "ogr2ogr", "-q", "-f", "GPKG", "-update",
                        "-nln", f"{prefix}contours",
                        "-lco", f"DESCRIPTION={made.credit}",
                        str(out), str(made.contours), "contours",
                    )  # fmt: skip
                    made.contours.unlink()
            for name, path in made.rasters.items():
                run(
                    "gdal_translate", "-q", "-of", "GPKG",
                    "-co", f"RASTER_TABLE={prefix}{name}",
                    "-co", f"RASTER_DESCRIPTION={made.credit}",
                    "-co", "APPEND_SUBDATASET=YES" if out.exists() else "APPEND_SUBDATASET=NO",
                    str(path), str(out),
                )  # fmt: skip
                path.unlink()
        return out
    raise AreaExportError(f"unknown area export format {fmt}")


Rgba = Tuple[int, int, int, int]


def slope_colours(bands: Sequence[dict]) -> List[Rgba]:
    """The colour of each whole degree (an index 0–255) for slope bands: a
    band takes fromDeg up to, not including, toDeg; every other value, the
    no-data 255 among them, is clear."""
    colours = [(0, 0, 0, 0)] * 256
    for band in bands:
        for deg in range(int(band["fromDeg"]), int(band["toDeg"])):
            colours[deg] = _parse_rgba_hex(band["colour"])
    return colours


# The shade gdaldem gives flat ground, 1 + 254 sin(sun altitude)
# (tests/test_area_export.py `HillshadeOfFlatGround`).
HILLSHADE_FLAT = round(1 + 254 * math.sin(math.radians(HILLSHADE_DEFAULTS["altitude"])))
HILLSHADE_MAX_ALPHA = 192


def hillshade_colours() -> List[Rgba]:
    """Each gdaldem shade (1–255) as a see-through overlay, so an app's
    basemap shows under it, as a GeoPDF's hillshade does. Flat ground is
    clear. Ground turned from the sun is black, and ground facing it white,
    more opaque the further its shade is from flat's. 0 is no-data, clear.
    The job pipeline's hillshade is an opaque sheet; this is not."""
    flat = HILLSHADE_FLAT

    def colour(v: int) -> Rgba:
        if v == 0 or v == flat:
            return (0, 0, 0, 0)
        if v < flat:
            return (0, 0, 0, round(HILLSHADE_MAX_ALPHA * (flat - v) / (flat - 1)))
        return (255, 255, 255, round(HILLSHADE_MAX_ALPHA * (v - flat) / (255 - flat)))

    return [colour(v) for v in range(256)]


def value_cog(source: Path, out: Path, nodata: int) -> None:
    """A Byte raster as a COG, its overviews for the low zooms."""
    run(
        "gdal_translate", "-q", "-a_nodata", str(nodata), "-of", "COG",
        "-co", "COMPRESS=DEFLATE", "-co", "BIGTIFF=IF_SAFER",
        "-co", "NUM_THREADS=ALL_CPUS",
        str(source), str(out),
    )  # fmt: skip


def styled_tile(cog: Path, colours: np.ndarray, z: int, x: int, y: int) -> Image.Image:
    """One tile of a Byte COG, value v drawn as colours[v] (a 256 x 4 table).
    The values are warped and then coloured, not the colours warped: GDAL's
    warp turns a clear colour opaque, and would blend two bands' colours at
    their edge."""
    lon_min, lat_min, lon_max, lat_max = tile_to_bbox(x, y, z)
    dataset = gdal.Warp(
        "", str(cog), format="MEM", dstSRS="EPSG:4326",
        outputBounds=(lon_min, lat_min, lon_max, lat_max),
        width=TILE_SIZE, height=TILE_SIZE, resampleAlg="bilinear", dstAlpha=True,
    )  # fmt: skip
    values, valid = dataset.ReadAsArray()
    rgba = colours[values]
    rgba[..., 3] = rgba[..., 3].astype(np.uint16) * valid // 255
    return Image.fromarray(rgba)


# The key of the account's bands in an MBTiles export's style snapshot,
# which shared/src/areaExport.ts `areaExportStyleSnapshot` writes
# (tests/test_area_export.py `SyncWithShared`).
STYLE_SLOPE_BANDS = "slopeBands"


def mbtiles_settings(style: dict) -> dict:
    """The pipeline's render settings for an export's style snapshot: the
    statewide contours' colours, widths and label size, and the account's
    slope bands. Contours step as the map's do: 50 m lines from z11, every
    10 m from z14, down to a 1 m area's z17."""
    settings = _vector_style_to_render_settings(style)
    settings["contours"]["zoomBands"] = [
        {"zoomMin": MBTILES_ZOOMS[0], "zoomMax": CONTOUR_ZMAX - 1,
         "intervalM": CONTOUR_MAJOR_M, "majorEveryN": 1},
        {"zoomMin": CONTOUR_ZMAX, "zoomMax": max(AREA_CELL_M),
         "intervalM": CONTOUR_INTERVAL_M,
         "majorEveryN": CONTOUR_MAJOR_M // CONTOUR_INTERVAL_M},
    ]  # fmt: skip
    if style.get(STYLE_SLOPE_BANDS):
        settings["slope"]["bands"] = style[STYLE_SLOPE_BANDS]
    return settings


def covers(heights: Archive, bbox: Bbox) -> bool:
    """Whether the statewide heights have a tile in the box: a box with
    none is outside NSW."""
    x0, y0, x1, y1 = tile_range(bbox, ZMAX)
    return any(
        heights.get(ZMAX, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)
    )


def fetch_contour_tiles(
    reader: Archive, bbox: Bbox, out: Path
) -> Dict[Tuple[int, int, int], str]:
    """The contour archive's tiles over the box, every zoom it has, written
    to `out` for GDAL's MVT driver. Returns the file of each tile with lines;
    flat ground has none. The files are named by index, never z/x/y: GDAL
    quotes the path in its errors and warnings, and a tile address in the
    log would place the box (tests/test_area_export.py)."""
    wanted = [
        (z, x, y)
        for z in range(MBTILES_ZOOMS[0], CONTOUR_ZMAX + 1)
        for x, y in tiles_for_bbox(*bbox, z)
    ]
    out.mkdir(parents=True, exist_ok=True)

    def fetch(job: Tuple[int, Tuple[int, int, int]]):
        index, zxy = job
        data = reader.get(*zxy)
        if not data:
            return None
        path = out / f"{index}.pbf"
        path.write_bytes(gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data)
        return zxy, str(path)

    with ThreadPoolExecutor(FETCH_THREADS) as pool:
        return dict(hit for hit in pool.map(fetch, enumerate(wanted)) if hit)


@lru_cache(maxsize=8)
def contour_lines(path: str, z: int, x: int, y: int) -> List[Tuple[dict, list]]:
    """One contour tile's lines, as `render_contours_tile` takes them:
    (feature, lon/lat coordinates). Cached: a z15 or z16 tile draws its z14
    parent's lines, and its siblings come to the same process in a row."""
    dataset = gdal.OpenEx(
        path, gdal.OF_VECTOR, allowed_drivers=["MVT"],
        open_options=[f"X={x}", f"Y={y}", f"Z={z}"],
    )  # fmt: skip
    lines = []
    for feature in dataset.GetLayerByName(CONTOUR_LAYER):
        geometry = feature.GetGeometryRef()
        parts = [geometry.GetGeometryRef(i) for i in range(geometry.GetGeometryCount())]
        for part in parts or [geometry]:
            merc = np.asarray(part.GetPoints() or [], dtype=float)
            if len(merc) < 2:
                continue
            lon = merc[:, 0] / HALF_WORLD_M * 180
            lat = np.degrees(
                2 * np.arctan(np.exp(merc[:, 1] / HALF_WORLD_M * np.pi)) - np.pi / 2
            )
            props = {"properties": {"elev": feature.GetField("elev")}}
            lines.append((props, np.column_stack([lon, lat]).tolist()))
    return lines


def clip_to_box(tile: Image.Image, bbox: Bbox, z: int, x: int, y: int) -> Image.Image:
    """The tile with everything outside the box cleared. A contour tile, or a
    z15 tile of a mosaic, runs past the box, and the file's bounds are the box.
    Pixels are linear in lon/lat, as the layers draw them."""
    lon_min, lat_min, lon_max, lat_max = tile_to_bbox(x, y, z)
    sx = TILE_SIZE / (lon_max - lon_min)
    sy = TILE_SIZE / (lat_max - lat_min)
    left, right = (round((lon - lon_min) * sx) for lon in (bbox[0], bbox[2]))
    top, bottom = (round((lat_max - lat) * sy) for lat in (bbox[3], bbox[1]))
    rect = (max(left, 0), max(top, 0), min(right, TILE_SIZE), min(bottom, TILE_SIZE))
    clipped = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    if rect[0] < rect[2] and rect[1] < rect[3]:
        clipped.paste(tile.crop(rect), rect[:2])
    return clipped


def intersect(a: Bbox, b: Bbox) -> Optional[Bbox]:
    west, south = max(a[0], b[0]), max(a[1], b[1])
    east, north = min(a[2], b[2]), min(a[3], b[3])
    return (west, south, east, north) if west < east and south < north else None


def tiles15_bounds(area: Area) -> Bbox:
    """The lon/lat bounds of an area's z15 tile range."""
    x0, y0, x1, y1 = area.tiles15
    west, _, _, north = tile_to_bbox(x0, y0, 15)
    _, south, east, _ = tile_to_bbox(x1, y1, 15)
    return west, south, east, north


AreaSource = Tuple[Area, Dict[str, GetBytes]]


def area_made(
    area: Area,
    archives: Dict[str, GetBytes],
    bbox: Bbox,
    layers: Sequence[str],
    work: Path,
    epsg: int,
    statewide_credit: str,
    name: str,
) -> Optional[Made]:
    """An area's own rasters over the part of the box its survey covers, at
    its cell and cut to its footprint, so its 5 m fill stays out. None when
    the box only meets the area's fill. The credit carries the 5 m one too:
    the cut is the footprint's, and its edge cells hold 5 m heights (ADR 0040)."""
    part = intersect(bbox, area.coverage)
    if part is None:
        return None
    sub = work / name
    sub.mkdir()
    cutline = None
    if area.footprint:
        cutline = sub / "footprint.geojson"
        cutline.write_text(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {},
                            "geometry": area.footprint,
                        }
                    ],
                }
            )
        )
    credit = f"{area_credit_line(layers, area.credit)} {statewide_credit}"
    try:
        made = make_layers(
            archives, part, layers, sub,
            epsg=epsg, zoom=area.zmax, cell=AREA_CELL_M[area.zmax],
            cutline=cutline, credit=credit,
        )  # fmt: skip
    except AreaOutsideNsw:  # no tile of the area's archive in the box
        shutil.rmtree(sub)  # so the next area takes this name
        return None
    made.name = name
    made.listed = area_credit_line(layers, area.credit)
    return made


def mbtiles_tile(job: tuple) -> Tuple[int, int, int, Optional[bytes]]:
    """One tile of the map, its layers in the pipeline's order. Runs in a
    worker process."""
    z, x, y, bbox, rasters, contours, settings = job
    tile = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    for layer in COMPOSITE_LAYER_ORDER:
        if layer in rasters:
            img = styled_tile(*rasters[layer], z, x, y)
        elif layer == "contours" and contours:
            lines = contour_lines(*contours)
            img = render_contours_tile({}, tile_to_bbox(x, y, z), z, settings, lines)
        else:
            continue
        tile = Image.alpha_composite(tile, img)
    tile = clip_to_box(tile, bbox, z, x, y)
    if tile.getextrema()[3][1] == 0:
        return z, x, y, None
    buf = io.BytesIO()
    tile.save(buf, format="PNG", optimize=True)
    return z, x, y, buf.getvalue()


def render_mbtiles(
    archives: Dict[str, GetBytes],
    bbox: Bbox,
    layers: Sequence[str],
    style: dict,
    work: Path,
    areas: Sequence[AreaSource] = (),
) -> Path:
    """The box as one MBTiles, drawn with the export's style snapshot. Each
    tile reads the one archive the map would (`tile_archive`): statewide, or
    an area down to its zmax, with z17 tiles inside a 1 m area."""
    heights_reader = Archive(archives["heights"])
    attribution = heights_reader.metadata().get("attribution")
    if not attribution:
        raise AreaExportError("the heights archive carries no attribution")
    # With slope or hillshade, write_mosaic finds a box outside NSW. With
    # contours alone the heights decide, because flat ground in NSW has no
    # contour tiles either (tests/test_area_export.py `ContoursAlone`).
    if not {"slope", "hillshade"} & set(layers) and not covers(heights_reader, bbox):
        raise AreaOutsideNsw("no heights tiles in the box")
    settings = mbtiles_settings(style)
    # Each raster layer's COG and its colour table.
    rasters: Dict[str, Tuple[Path, np.ndarray]] = {}
    if "hillshade" in layers:
        mosaic = work / "heights-3857.tif"
        shade = work / "hillshade-3857.tif"
        write_mosaic(heights_reader, bbox, mosaic, "heights", attribution)
        gdal.DEMProcessing(
            str(shade), str(mosaic), "hillshade",
            azimuth=HILLSHADE_DEFAULTS["azimuth"],
            altitude=HILLSHADE_DEFAULTS["altitude"],
            zFactor=HILLSHADE_DEFAULTS["zFactor"],
            # Web-mercator metres are cos(latitude) metres on the ground.
            scale=math.cos(math.radians((bbox[1] + bbox[3]) / 2)),
            computeEdges=True,
            creationOptions=["TILED=YES", "COMPRESS=DEFLATE", "BIGTIFF=IF_SAFER"],
        )  # fmt: skip
        mosaic.unlink()
        rasters["hillshade"] = (
            work / "hillshade.tif",
            np.array(hillshade_colours(), np.uint8),
        )
        value_cog(shade, rasters["hillshade"][0], 0)
        shade.unlink()
    if "slope" in layers:
        mosaic = work / "slope-3857.tif"
        write_mosaic(Archive(archives["slope"]), bbox, mosaic, "slope", attribution)
        rasters["slope"] = (
            work / "slope.tif",
            np.array(slope_colours(settings["slope"]["bands"]), np.uint8),
        )
        value_cog(mosaic, rasters["slope"][0], SLOPE_NODATA)
        mosaic.unlink()
    contour_files: Dict[Tuple[int, int, int], str] = {}
    if "contours" in layers:
        contour_files = fetch_contour_tiles(
            Archive(archives["contours"]), bbox, work / "contours"
        )

    # Each area's own layers over the part of the box its tiles hold. An
    # area's archive lacks a tile only where neither its survey nor the 5 m it
    # was filled from has a height (sea, past the border). One with no tile in
    # the box is left out, so a later area answers there, else statewide.
    routed: List[Area] = []
    area_rasters: Dict[str, Dict[str, Tuple[Path, np.ndarray]]] = {}
    area_contours: Dict[str, Dict[Tuple[int, int, int], str]] = {}
    in_box = [(a, arch) for a, arch in areas if intersect(bbox, tiles15_bounds(a))]
    for i, (area, arch) in enumerate(in_box, 1):
        part = intersect(bbox, tiles15_bounds(area))
        own: Dict[str, Tuple[Path, np.ndarray]] = {}
        made = [work / f"a{i}-{n}.tif" for n in ("heights", "shade", "slope-3857")]
        try:
            if "hillshade" in layers:
                mosaic, shade = made[0], made[1]
                write_mosaic(
                    Archive(arch["heights"]), part, mosaic, "heights", attribution,
                    area.zmax,
                )  # fmt: skip
                gdal.DEMProcessing(
                    str(shade), str(mosaic), "hillshade",
                    azimuth=HILLSHADE_DEFAULTS["azimuth"],
                    altitude=HILLSHADE_DEFAULTS["altitude"],
                    zFactor=HILLSHADE_DEFAULTS["zFactor"],
                    scale=math.cos(math.radians((bbox[1] + bbox[3]) / 2)),
                    computeEdges=True,
                    creationOptions=["TILED=YES", "COMPRESS=DEFLATE", "BIGTIFF=IF_SAFER"],
                )  # fmt: skip
                own["hillshade"] = (
                    work / f"a{i}-hillshade.tif",
                    rasters["hillshade"][1],
                )
                value_cog(shade, own["hillshade"][0], 0)
            if "slope" in layers:
                mosaic = made[2]
                write_mosaic(
                    Archive(arch["slope"]), part, mosaic, "slope", attribution,
                    area.zmax,
                )  # fmt: skip
                own["slope"] = (work / f"a{i}-slope.tif", rasters["slope"][1])
                value_cog(mosaic, own["slope"][0], SLOPE_NODATA)
        except AreaOutsideNsw:
            for path in [*made, *(cog for cog, _ in own.values())]:
                path.unlink(missing_ok=True)
            continue
        finally:
            for path in made:
                path.unlink(missing_ok=True)
        routed.append(area)
        area_rasters[area.id] = own
        if "contours" in layers and area.contours:
            area_contours[area.id] = fetch_contour_tiles(
                Archive(arch["contours"]), part, work / f"a{i}-contours"
            )
    # The layers each area won a tile for, which it is credited for.
    drew: Dict[str, set] = {area.id: set() for area in routed}

    def contour_tile(z: int, x: int, y: int) -> Optional[tuple]:
        """The file and address of the contour tile a tile draws: itself,
        or its z14 parent from z15 up, from the archive it routes to."""
        cz = min(z, CONTOUR_ZMAX)
        parent = (cz, x >> (z - cz), y >> (z - cz))
        answer = tile_archive(routed, "contours", z, x, y)
        files = (
            area_contours.get(answer.id, {})
            if isinstance(answer, Area)
            else contour_files
        )
        path = files.get(parent)
        if path and isinstance(answer, Area):
            drew[answer.id].add("contours")
        return (path, *parent) if path else None

    def tile_rasters(z: int, x: int, y: int) -> Dict[str, Tuple[Path, np.ndarray]]:
        """The COG each raster layer of a tile reads. Past z15 outside every
        area the map overzooms z15; this file draws z16 from it, as before."""
        chosen = {}
        for layer, cog in rasters.items():
            answer = tile_archive(
                routed, "heights" if layer == "hillshade" else "slope", z, x, y
            )
            if isinstance(answer, Area):
                chosen[layer] = area_rasters[answer.id][layer]
                drew[answer.id].add(layer)
            elif z <= MBTILES_ZOOMS[1]:
                chosen[layer] = cog
        return chosen

    zmin, zmax = MBTILES_ZOOMS
    tiles = [
        (z, x, y) for z in range(zmin, zmax + 1) for x, y in tiles_for_bbox(*bbox, z)
    ]
    for area in routed:
        if area.zmax > zmax:
            tiles += [
                (area.zmax, x, y)
                for x, y in tiles_for_bbox(
                    *intersect(bbox, tiles15_bounds(area)), area.zmax
                )
                if tile_archive(routed, "slope", area.zmax, x, y) is area
            ]
    zmax = max(t[0] for t in tiles)
    # Siblings under one z14 parent in a row, so a worker's line cache hits.
    tiles.sort(
        key=lambda t: (
            t[0],
            t[1] >> max(0, t[0] - CONTOUR_ZMAX),
            t[2] >> max(0, t[0] - CONTOUR_ZMAX),
        )
    )
    jobs = [
        (z, x, y, bbox, tile_rasters(z, x, y), contour_tile(z, x, y), settings)
        for z, x, y in tiles
    ]
    out = work / "logjam-area.mbtiles"
    credit = " ".join(
        dict.fromkeys(
            [credit_line(layers, attribution)]
            + [
                area_credit_line(sorted(drew[area.id]), area.credit)
                for area in routed
                if drew[area.id]
            ]
        )
    )
    conn = create_mbtiles(str(out), "logjam-area", credit, zmin, zmax, credit)
    with ProcessPoolExecutor(_composite_workers()) as pool:
        for z, x, y, png in pool.map(mbtiles_tile, jobs, chunksize=64):
            if png is not None:
                insert_tile(conn, z, x, y, png)
    finalise_bounds(conn, *bbox, center_zoom=(zmin + MBTILES_ZOOMS[1]) // 2)
    conn.close()
    for path, _ in [
        *rasters.values(),
        *(c for own in area_rasters.values() for c in own.values()),
    ]:
        path.unlink()
    return out


def render_area(
    archives: Dict[str, GetBytes],
    bbox: Bbox,
    layers: Sequence[str],
    fmt: str,
    work: Path,
    style: Optional[dict] = None,
    areas: Sequence[AreaSource] = (),
) -> Path:
    """`style` is the export's style snapshot, which only an MBTiles draws.
    `areas` are the sharpened areas the API chose, in the router's order,
    each with its archives."""
    allowed = LAYERS_BY_FORMAT.get(fmt)
    if allowed is None or not layers or any(l not in allowed for l in layers):
        raise AreaExportError(f"bad request: {fmt} {layers}")
    if fmt == "mbtiles":
        return render_mbtiles(archives, bbox, layers, style or {}, work, areas)
    statewide = make_layers(archives, bbox, layers, work)
    epsg = mga_epsg((bbox[0] + bbox[2]) / 2)
    mades = [statewide]
    for area, arch in areas:
        made = area_made(
            area, arch, bbox, layers, work, epsg, statewide.credit,
            f"sharpened-{len(mades)}",
        )  # fmt: skip
        if made is not None:
            mades.append(made)
    return package(mades, fmt, work)


def s3_archives(s3, bucket: str) -> Dict[str, GetBytes]:
    return {
        "heights": s3_ranges(s3, bucket, HEIGHT_KEY),
        "slope": s3_ranges(s3, bucket, SLOPE_KEY),
        "contours": s3_ranges(s3, bucket, CONTOUR_KEY),
    }


def s3_area_archives(s3, bucket: str, area: Area) -> Dict[str, GetBytes]:
    return {
        layer: s3_ranges(s3, bucket, key) for layer, key in area.keys.items() if key
    }
