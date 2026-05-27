"""MBTiles export.

Per-layer: produces one MBTiles file per requested layer.
  - Raster layers → GDAL tile pyramid from the stored COG (gdal_translate
    -of MBTiles applies its own COG → tile-pyramid pipeline). Style is
    already baked into the COG.
  - Vector layers → tippecanoe on the raw GeoJSON, applying the snapshotted
    vector style at paint time via the MBTiles metadata blob.

Composite: one MBTiles containing all selected layers, alpha-composited
per-tile. Sources: COGs for raster layers (already styled), raw GeoJSONs for
vector layers (styled live against vector_style_snapshot during render).
"""

from __future__ import annotations

import logging
import subprocess
import zipfile
from pathlib import Path

from .context import RenderContext, RenderError, RASTER_LAYERS, VECTOR_LAYERS

log = logging.getLogger("export_worker.mbtiles")


def _per_layer_raster_mbtiles(ctx: RenderContext, layer: str) -> Path:
    src_cog = ctx.cog_path(ctx.primary_job["id"], layer)
    dst = ctx.work_dir / f"{layer}.mbtiles"
    cmd = [
        "gdal_translate",
        "-of", "MBTILES",
        str(src_cog),
        str(dst),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RenderError(f"gdal_translate MBTILES ({layer}) failed:\n{result.stderr.strip()}")
    # Build overviews so Gaia can zoom out without a black canvas.
    ov = subprocess.run(
        ["gdaladdo", "-r", "average", str(dst), "2", "4", "8", "16", "32"],
        capture_output=True, text=True,
    )
    if ov.returncode != 0:
        log.warning(f"gdaladdo on {layer}.mbtiles failed: {ov.stderr.strip()}")
    return dst


def _per_layer_vector_mbtiles(ctx: RenderContext, layer: str) -> Path:
    src = ctx.geojson_path(ctx.primary_job["id"], layer)
    dst = ctx.work_dir / f"{layer}.mbtiles"
    layer_name = "contours" if layer == "contours" else "features"
    cmd = [
        "tippecanoe",
        "-o", str(dst),
        "-z", "18", "-Z", "12",
        "--no-feature-limit", "--no-tile-size-limit",
        "-l", layer_name,
        "--force",
        str(src),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RenderError(f"tippecanoe ({layer}) failed:\n{result.stderr.strip()}")
    return dst


def render_mbtiles(ctx: RenderContext) -> Path:
    if ctx.is_composite:
        from .tile_compose import render_composite_to_mbtiles
        return render_composite_to_mbtiles(ctx, ctx.layers)

    produced: list[Path] = []
    for layer in ctx.layers:
        if layer in RASTER_LAYERS:
            produced.append(_per_layer_raster_mbtiles(ctx, layer))
        elif layer in VECTOR_LAYERS:
            produced.append(_per_layer_vector_mbtiles(ctx, layer))
        else:
            raise RenderError(f"Unknown layer: {layer}")

    if len(produced) == 1:
        return produced[0]
    zip_path = ctx.work_dir / "mbtiles.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in produced:
            zf.write(p, arcname=p.name)
    return zip_path
