"""Composite tile rendering for export.

Stage 2 plan calls for headless MapLibre Native here, but that pipeline has
significant risk (see plan §Risks). This module ships a working Python
implementation using GDAL + PIL that reuses the existing tile compositor in
topo_mbtiles.py. Headless MapLibre Native can replace this implementation
later behind the same render_composite_to_* function signatures.

MBTiles composite (`render_composite_to_mbtiles`):
  1. Load source COGs for selected raster layers (already styled).
  2. Load raw vector GeoJSONs for selected vector layers.
  3. Compose the snapshotted VectorStyleSettings into the legacy TopoSettings
     shape that topo_mbtiles renderers expect.
  4. For each (z, x, y) tile in the bbox:
     - For each raster layer: gdal.Warp the COG into a 256x256 RGBA PNG window.
     - For each vector layer: call topo_mbtiles.render_contours_tile / render_features_tile.
     - Alpha-composite in order: hillshade → vegetation → features → slope → contours.

GeoTIFF composite (`render_composite_to_geotiff`):
  Raster-only — vectors are excluded by `EXPORT_FORMAT_RULES.geotiff.allowVector
  = false`. Alpha-aware `gdal.Warp` chain over the source COGs: create an empty
  RGBA destination matching the first COG's grid, then warp each layer in
  bottom→top order with `srcAlpha=True, dstAlpha=True` so GDAL performs
  source-over compositing against existing destination pixels. Re-encode as COG.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Tuple

# Make topo_mbtiles importable as a sibling module.
_TOPO_DIR = Path(__file__).resolve().parent.parent
if str(_TOPO_DIR) not in sys.path:
    sys.path.insert(0, str(_TOPO_DIR))

import numpy as np
from osgeo import gdal
from PIL import Image

import topo_mbtiles as tm  # noqa: E402
from topo_mbtiles import (  # noqa: E402
    TILE_SIZE, ZOOM_MIN, ZOOM_MAX, WGS84_EPSG,
    create_mbtiles, finalise_bounds, insert_tile,
    tiles_for_bbox, tile_to_bbox,
    render_contours_tile, render_features_tile,
)

from .context import RenderContext, RenderError, RASTER_LAYERS, VECTOR_LAYERS

log = logging.getLogger("export_worker.tile_compose")


def _vector_style_to_render_settings(vector_style: Dict[str, Any]) -> Dict[str, Any]:
    """Convert the user-snapshotted VectorStyleSettings into the legacy
    TopoSettings shape topo_mbtiles renderers consume. Raster-bake template
    fields (slope bands, hillshade params, etc.) are unused here because the
    COGs are already styled — only the vector-side settings matter for
    re-rendering contours and features."""
    defaults = tm._default_render_settings()
    if not isinstance(vector_style, dict):
        # The API validator enforces the snapshot shape on write, so a non-dict
        # here means corruption — fail loudly rather than silently default-style.
        raise RenderError(
            f"Malformed vector_style_snapshot (expected dict, got {type(vector_style).__name__})"
        )

    contours_in = vector_style.get("contours", {}) or {}
    defaults["contours"].update({
        k: contours_in[k] for k in ("majorColour", "minorColour", "majorWidthM", "minorWidthM")
        if k in contours_in
    })

    features_in = vector_style.get("features", {}) or {}
    if isinstance(features_in, dict):
        # Render expects {"features": {category: {enabled, colour, widthZ18}}}
        defaults["features"]["features"] = features_in
    return defaults


def _bbox_union(jobs: List[dict]) -> Tuple[float, float, float, float]:
    """Union of every source job's footprint geometry, in WGS84 lon/lat."""
    from shapely.geometry import shape
    from shapely.ops import unary_union
    polys = []
    for j in jobs:
        fp = j.get("footprint")
        if not fp:
            continue
        polys.append(shape(fp))
    if not polys:
        raise RenderError("No source-job footprints available — cannot compute export bounds")
    geom = unary_union(polys)
    return tuple(geom.bounds)   # (minx, miny, maxx, maxy)


def _warp_cog_to_tile(cog_path: Path, z: int, x: int, y: int) -> Image.Image:
    """Warp a window of the COG into a TILE_SIZE×TILE_SIZE RGBA PIL image."""
    lon_min, lat_min, lon_max, lat_max = tile_to_bbox(x, y, z)
    out_ds = gdal.Warp(
        "",
        str(cog_path),
        format="MEM",
        dstSRS=f"EPSG:{WGS84_EPSG}",
        outputBounds=(lon_min, lat_min, lon_max, lat_max),
        width=TILE_SIZE,
        height=TILE_SIZE,
        resampleAlg="bilinear",
        dstAlpha=True,
    )
    if out_ds is None:
        return Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    bands = out_ds.RasterCount
    arr = out_ds.ReadAsArray()
    out_ds = None
    if bands == 1:
        gray = arr.astype(np.uint8)
        rgba = np.stack([gray, gray, gray, np.full_like(gray, 255)], axis=-1)
    elif bands == 3:
        rgba = np.stack([arr[0], arr[1], arr[2], np.full_like(arr[0], 255)], axis=-1).astype(np.uint8)
    elif bands == 4:
        rgba = np.stack([arr[0], arr[1], arr[2], arr[3]], axis=-1).astype(np.uint8)
    else:
        # Unknown band layout — return transparent tile rather than corrupting.
        return Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    return Image.fromarray(rgba)


def _composite_tile(
    z: int, x: int, y: int,
    raster_cogs: Dict[str, Path],
    contour_paths: Dict[float, str],
    features_geojson: str | None,
    settings: Dict[str, Any],
) -> bytes | None:
    """Render one composite tile. Returns PNG bytes or None if fully transparent."""
    composite = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))

    # Order matches topo_mbtiles.render_tile_job composite order. OSM features
    # are topmost so roads/water/labels read over contours, matching the web map.
    order = ["hillshade", "vegetation", "slope", "contours", "features"]
    bbox_wgs84 = tile_to_bbox(x, y, z)

    for layer in order:
        if layer in raster_cogs:
            img = _warp_cog_to_tile(raster_cogs[layer], z, x, y)
        elif layer == "contours" and contour_paths:
            img = render_contours_tile(contour_paths, bbox_wgs84, z, settings)
        elif layer == "features" and features_geojson:
            img = render_features_tile(features_geojson, bbox_wgs84, z, settings)
        else:
            continue
        composite = Image.alpha_composite(composite, img)

    if composite.split()[3].getextrema()[1] == 0:
        return None
    from io import BytesIO
    buf = BytesIO()
    composite.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _prepare_sources(ctx: RenderContext, layers: List[str]) -> Tuple[
    Dict[str, Path], Dict[float, str], str | None, Dict[str, Any]
]:
    raster_cogs: Dict[str, Path] = {}
    contour_paths: Dict[float, str] = {}
    features_geojson: str | None = None

    job_id = ctx.primary_job["id"]
    for layer in layers:
        if layer in RASTER_LAYERS:
            raster_cogs[layer] = ctx.cog_path(job_id, layer)
        elif layer == "contours":
            # Only contours_5m.geojson is published for export; it holds every
            # 5 m line keyed by `elev`. Register it under both the 50 m and 5 m
            # interval keys so render_contours_tile can serve both bands from
            # the one file — its modulo filter keeps only the matching lines.
            geojson_5m = str(ctx.geojson_path(job_id, "contours"))
            contour_paths[50.0] = geojson_5m
            contour_paths[5.0] = geojson_5m
        elif layer == "features":
            features_geojson = str(ctx.geojson_path(job_id, "features"))

    settings = _vector_style_to_render_settings(ctx.vector_style)
    # Reproduce the web map's contour zoom behaviour: only major (50 m) contours
    # at z12-13, full 5 m contours + 50 m labels at z14+. The 50 m lines (drawn
    # by the coarser inherited pass) carry the elevation labels; the 5 m pass
    # fills in minor contours. Matches the frontend `minzoom: 14` minor/label
    # layers in Map.tsx.
    settings["contours"].setdefault("enabled", True)
    settings["contours"]["zoomBands"] = [
        {"zoomMin": 12, "zoomMax": 13, "intervalM": 50, "majorEveryN": 1},
        {"zoomMin": 14, "zoomMax": 18, "intervalM": 5, "majorEveryN": 10},
    ]
    return raster_cogs, contour_paths, features_geojson, settings


def _composite_tile_worker(args: Tuple) -> Tuple[int, int, int, bytes | None]:
    """ProcessPoolExecutor entrypoint — must be module-level to be picklable."""
    z, x, y, raster_cogs, contour_paths, features_geojson, settings = args
    png = _composite_tile(z, x, y, raster_cogs, contour_paths, features_geojson, settings)
    return z, x, y, png


def _composite_workers() -> int:
    env = os.environ.get("TOPO_TILE_WORKERS")
    if env:
        return max(1, int(env))
    return max(1, min(8, os.cpu_count() or 1))


def render_composite_to_mbtiles(ctx: RenderContext, layers: List[str]) -> Path:
    raster_cogs, contour_paths, features_geojson, settings = _prepare_sources(ctx, layers)
    lon_min, lat_min, lon_max, lat_max = _bbox_union(ctx.source_jobs)

    dst = ctx.work_dir / "composite.mbtiles"
    if dst.exists():
        dst.unlink()
    conn = create_mbtiles(str(dst), "composite", "Topo composite export")

    tile_jobs = [
        (z, x, y, raster_cogs, contour_paths, features_geojson, settings)
        for z in range(ZOOM_MIN, ZOOM_MAX + 1)
        for x, y in tiles_for_bbox(lon_min, lat_min, lon_max, lat_max, z)
    ]

    # Render tiles in parallel; sqlite is single-writer so inserts stay in the
    # foreground as results arrive.
    workers = _composite_workers()
    total = 0
    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(_composite_tile_worker, job) for job in tile_jobs]
        for future in as_completed(futures):
            z, x, y, png = future.result()
            if png is not None:
                insert_tile(conn, z, x, y, png)
                total += 1

    if total == 0:
        conn.close()
        dst.unlink(missing_ok=True)
        raise RenderError(
            "Composite MBTiles produced no tiles (footprint too small for the configured zoom range)"
        )

    finalise_bounds(conn, lon_min, lat_min, lon_max, lat_max)
    conn.commit()
    conn.close()
    log.info(f"Composite MBTiles written: {total} tiles using {workers} worker(s) → {dst}")
    return dst


def render_composite_to_geotiff(ctx: RenderContext, raster_layers: List[str]) -> Path:
    """Composite the selected raster COGs into a single GeoTIFF.

    Raster-only — vector layers are NOT included (Stage 2 GeoTIFF format is
    raster-only, see EXPORT_FORMAT_RULES.geotiff.allowVector = false).

    Strategy: create an empty RGBA destination matching the first COG's grid,
    then warp each source COG (bottom→top) into it with srcAlpha/dstAlpha so
    GDAL performs source-over alpha compositing against the existing pixels.
    BuildVRT is deliberately NOT used — it mosaics rather than alpha-blends, and
    a nodata mask corrupts the RGBA alpha band and drops valid colour-0 pixels.
    """
    if not raster_layers:
        raise RenderError("GeoTIFF composite requires at least one raster layer")

    job_id = ctx.primary_job["id"]
    cogs = [ctx.cog_path(job_id, l) for l in raster_layers]

    # Use the first COG as the spatial template (extent + resolution + SRS).
    # Single-job composites share the source MBTiles grid, so cogs[0] covers
    # the full footprint at native resolution.
    template = gdal.Open(str(cogs[0]))
    if template is None:
        raise RenderError(f"Could not open source COG {cogs[0]}")
    geotransform = template.GetGeoTransform()
    projection = template.GetProjectionRef()
    xsize, ysize = template.RasterXSize, template.RasterYSize
    template = None

    intermediate = ctx.work_dir / "composite_intermediate.tif"
    driver = gdal.GetDriverByName("GTiff")
    dst_ds = driver.Create(
        str(intermediate), xsize, ysize, 4, gdal.GDT_Byte,
        options=["COMPRESS=DEFLATE", "TILED=YES", "BIGTIFF=IF_SAFER"],
    )
    dst_ds.SetGeoTransform(geotransform)
    dst_ds.SetProjection(projection)
    dst_ds.GetRasterBand(4).SetColorInterpretation(gdal.GCI_AlphaBand)
    for band_index in range(1, 5):
        dst_ds.GetRasterBand(band_index).Fill(0)
    dst_ds.FlushCache()
    dst_ds = None

    # Warp each COG onto the destination. Warping into an existing dataset does
    # not re-initialise it (no INIT_DEST), so each layer composites over the
    # previous one using source alpha.
    for cog in cogs:
        gdal.Warp(
            str(intermediate),
            str(cog),
            format="GTiff",
            srcAlpha=True,
            dstAlpha=True,
            resampleAlg="bilinear",
        )

    dst = ctx.work_dir / "composite.tif"
    gdal.Translate(
        str(dst),
        str(intermediate),
        format="COG",
        creationOptions=[
            "COMPRESS=DEFLATE",
            "BIGTIFF=IF_SAFER",
            "BLOCKSIZE=512",
            "OVERVIEWS=AUTO",
        ],
    )
    intermediate.unlink(missing_ok=True)
    return dst


def composite_raster_cogs(ctx: RenderContext, raster_layers: List[str]) -> Path:
    """Public helper exposed to gpkg.py — same as render_composite_to_geotiff
    but exists as a named function so the GPKG renderer can chain it."""
    return render_composite_to_geotiff(ctx, raster_layers)
