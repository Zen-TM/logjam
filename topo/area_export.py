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

An MBTiles stays in web mercator, where its tiles are. Its contours are the
statewide contour archive's own lines, the ones the map draws, read a tile at
a time: recut from the heights, a 100 km box is ~60 M vertices, and the
renderer would hold them all in each process.
"""

from __future__ import annotations

import gzip
import io
import logging
import math
import subprocess
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple

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


def credit_line(layers: Sequence[str], attribution: str) -> str:
    """One credit for every layer in the file, from the heights archive's own
    attribution ("Derived from the NSW 5 m … extracted October 2026 …"): each
    layer is derived from the same DEM, and the archive knows its extract date.
    """
    names = [l for l in LAYERS if l in layers]
    listed = names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"
    return f"{listed[0].upper()}{listed[1:]}: {attribution[0].lower()}{attribution[1:]}"


def tile_range(bbox: Bbox, zoom: int) -> Tuple[int, int, int, int]:
    """(x0, y0, x1, y1), inclusive, of the tiles covering a box."""
    west, south, east, north = bbox
    x0, y0 = lonlat_to_tile(west, north, zoom)
    x1, y1 = lonlat_to_tile(east, south, zoom)
    return x0, y0, x1, y1


def mga_extent(bbox: Bbox, epsg: int) -> Tuple[Bbox, Bbox]:
    """The MGA rectangle a box is warped to, on the 5 m grid, and that
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
        math.floor(xmin / CELL_M) * CELL_M,
        math.floor(ymin / CELL_M) * CELL_M,
        math.ceil(xmax / CELL_M) * CELL_M,
        math.ceil(ymax / CELL_M) * CELL_M,
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
) -> None:
    """The archive's z15 tiles over the box as one tiled web-mercator GeoTIFF:
    heights as Float32 (no-data NODATA), slope as Byte degrees (no-data 255).
    Tiles are fetched and decoded in threads and written by this one, a chunk
    at a time."""
    x0, y0, x1, y1 = tile_range(bbox, ZMAX)
    cols, rows = x1 - x0 + 1, y1 - y0 + 1
    west, _, _, north = tile_bounds_3857(ZMAX, x0, y0)
    span = tile_bounds_3857(ZMAX, x0, y0)[2] - west
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
        png = reader.get(ZMAX, x, y)
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


def run(*command: str) -> None:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise AreaExportError(f"{command[0]} failed: {result.stderr.strip()}")


def warp_to_mga(
    source: Path, out: Path, rect: Bbox, epsg: int, resampling: str
) -> None:
    run(
        "gdalwarp", "-q", "-overwrite",
        "-t_srs", f"EPSG:{epsg}",
        "-te", *map(str, rect),
        "-tr", str(CELL_M), str(CELL_M),
        "-r", resampling,
        "-multi", "-wo", "NUM_THREADS=ALL_CPUS", "-wm", "512",
        "-of", "COG",
        "-co", "COMPRESS=DEFLATE", "-co", "PREDICTOR=YES",
        "-co", "BIGTIFF=IF_SAFER", "-co", "NUM_THREADS=ALL_CPUS",
        str(source), str(out),
    )  # fmt: skip


@dataclass
class Made:
    rasters: Dict[str, Path]
    contours: Optional[Path]
    credit: str


def make_layers(
    archives: Dict[str, GetBytes],
    bbox: Bbox,
    layers: Sequence[str],
    work: Path,
) -> Made:
    """Every requested layer as a file in MGA, in `work`."""
    steps = plan(layers)
    epsg = mga_epsg((bbox[0] + bbox[2]) / 2)
    heights_reader = Archive(archives["heights"])
    attribution = heights_reader.metadata().get("attribution")
    if not attribution:
        raise AreaExportError("the heights archive carries no attribution")
    credit = credit_line(layers, attribution)
    rect, around = mga_extent(bbox, epsg)
    rasters: Dict[str, Path] = {}

    if steps["heights"]:
        mosaic = work / "heights-3857.tif"
        write_mosaic(heights_reader, around, mosaic, "heights", credit)
        rasters["heights"] = work / "heights.tif"
        warp_to_mga(mosaic, rasters["heights"], rect, epsg, "bilinear")
        mosaic.unlink()
    if steps["slope"]:
        mosaic = work / "slope-3857.tif"
        write_mosaic(Archive(archives["slope"]), around, mosaic, "slope", credit)
        rasters["slope"] = work / "slope.tif"
        warp_to_mga(mosaic, rasters["slope"], rect, epsg, "near")
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
        # The statewide build's recipe (build_nsw_dem.contours): averaged to
        # 10 m first, or the lines follow every knob of the 5 m grid.
        cell = str(CONTOUR_CELL_M)
        run(
            "gdalwarp", "-q", "-overwrite", "-tr", cell, cell, "-r", "average",
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


def package(made: Made, fmt: str, work: Path) -> Path:
    """The file the user downloads."""
    if fmt == "geotiff":
        out = work / "logjam-area.zip"
        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_STORED) as zf:
            # The rasters are compressed already.
            for name, path in made.rasters.items():
                zf.write(path, arcname=f"{name}.tif")
                path.unlink()  # one copy of each raster on disk at a time
            zf.writestr("CREDITS.txt", f"{made.credit}\n\n{DISCLAIMER}\n")
        return out
    if fmt == "gpkg":
        out = made.contours if made.contours is not None else work / "logjam-area.gpkg"
        for name, path in made.rasters.items():
            run(
                "gdal_translate", "-q", "-of", "GPKG",
                "-co", f"RASTER_TABLE={name}",
                "-co", f"RASTER_DESCRIPTION={made.credit}",
                "-co", "APPEND_SUBDATASET=YES" if out.exists() else "APPEND_SUBDATASET=NO",
                str(path), str(out),
            )  # fmt: skip
            path.unlink()
        final = work / "logjam-area.gpkg"
        if out != final:
            out.rename(final)
        return final
    raise AreaExportError(f"unknown area export format {fmt}")


Rgba = Tuple[int, int, int, int]


def slope_colours(bands: Sequence[dict]) -> List[Rgba]:
    """The colour of each whole degree (an index 0–255) for slope bands: a
    band takes fromDeg up to, not including, toDeg, as `render_slope_tile`
    draws it; every other value, the no-data 255 among them, is clear."""
    colours = [(0, 0, 0, 0)] * 256
    for band in bands:
        for deg in range(int(band["fromDeg"]), int(band["toDeg"])):
            colours[deg] = _parse_rgba_hex(band["colour"])
    return colours


def hillshade_colours(tint: str) -> List[Rgba]:
    """Each shade (0–255) under a tint, as `render_hillshade_tile` draws it;
    0 is gdaldem's no-data, so clear."""
    r, g, b, a = _parse_rgba_hex(tint)
    return [(0, 0, 0, 0)] + [
        (v * r // 255, v * g // 255, v * b // 255, a) for v in range(1, 256)
    ]


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


def mbtiles_settings(style: dict) -> dict:
    """The pipeline's render settings for the account's style: its contour
    colours, widths and label size, and its slope bands. Contours step as the
    map's do: 50 m lines from z11, every 10 m from z14."""
    settings = _vector_style_to_render_settings(style)
    settings["contours"]["zoomBands"] = [
        {"zoomMin": MBTILES_ZOOMS[0], "zoomMax": CONTOUR_ZMAX - 1,
         "intervalM": CONTOUR_MAJOR_M, "majorEveryN": 1},
        {"zoomMin": CONTOUR_ZMAX, "zoomMax": MBTILES_ZOOMS[1],
         "intervalM": CONTOUR_INTERVAL_M,
         "majorEveryN": CONTOUR_MAJOR_M // CONTOUR_INTERVAL_M},
    ]  # fmt: skip
    if style.get("slopeBands"):
        settings["slope"]["bands"] = style["slopeBands"]
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
) -> Path:
    """The box as one MBTiles, drawn with the account's style."""
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
            np.array(hillshade_colours(HILLSHADE_DEFAULTS["colour"]), np.uint8),
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

    def contour_tile(z: int, x: int, y: int) -> Optional[tuple]:
        """The file and address of the contour tile a tile draws: itself,
        or its z14 parent from z15 up."""
        cz = min(z, CONTOUR_ZMAX)
        parent = (cz, x >> (z - cz), y >> (z - cz))
        path = contour_files.get(parent)
        return (path, *parent) if path else None

    zmin, zmax = MBTILES_ZOOMS
    tiles = [
        (z, x, y) for z in range(zmin, zmax + 1) for x, y in tiles_for_bbox(*bbox, z)
    ]
    # Siblings under one z14 parent in a row, so a worker's line cache hits.
    tiles.sort(
        key=lambda t: (
            t[0],
            t[1] >> max(0, t[0] - CONTOUR_ZMAX),
            t[2] >> max(0, t[0] - CONTOUR_ZMAX),
        )
    )
    out = work / "logjam-area.mbtiles"
    conn = create_mbtiles(
        str(out), "logjam-area", credit_line(layers, attribution), zmin, zmax
    )
    conn.execute(
        "INSERT OR REPLACE INTO metadata VALUES ('attribution', ?)",
        (credit_line(layers, attribution),),
    )
    jobs = [
        (z, x, y, bbox, rasters, contour_tile(z, x, y), settings) for z, x, y in tiles
    ]
    with ProcessPoolExecutor(_composite_workers()) as pool:
        for z, x, y, png in pool.map(mbtiles_tile, jobs, chunksize=64):
            if png is not None:
                insert_tile(conn, z, x, y, png)
    finalise_bounds(conn, *bbox, center_zoom=(zmin + zmax) // 2)
    conn.close()
    for path, _ in rasters.values():
        path.unlink()
    return out


def render_area(
    archives: Dict[str, GetBytes],
    bbox: Bbox,
    layers: Sequence[str],
    fmt: str,
    work: Path,
    style: Optional[dict] = None,
) -> Path:
    """`style` is the export's style snapshot, which only an MBTiles draws."""
    allowed = LAYERS_BY_FORMAT.get(fmt)
    if allowed is None or not layers or any(l not in allowed for l in layers):
        raise AreaExportError(f"bad request: {fmt} {layers}")
    if fmt == "mbtiles":
        return render_mbtiles(archives, bbox, layers, style or {}, work)
    return package(make_layers(archives, bbox, layers, work), fmt, work)


def s3_archives(s3, bucket: str) -> Dict[str, GetBytes]:
    return {
        "heights": s3_ranges(s3, bucket, HEIGHT_KEY),
        "slope": s3_ranges(s3, bucket, SLOPE_KEY),
        "contours": s3_ranges(s3, bucket, CONTOUR_KEY),
    }
