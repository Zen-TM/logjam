"""GeoPackage export — single file with vector feature tables and (optionally)
a raster tile pyramid.

Bundling="composite" produces one .gpkg containing every selected layer:
  - raster layers → a single composite tile pyramid table
  - vector layers → one feature table each (`contours_5m`, `osm_features`)
Bundling="per-layer" is rejected upstream (EXPORT_FORMAT_RULES.gpkg.allowPerLayer
= false) — GeoPackage is inherently bundled.

QGIS handles GPKG raster tile pyramids natively. Many mobile apps (Gaia GPS,
Avenza) do not yet — frontend dialog calls this out in tooltip copy.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from .context import RenderContext, RenderError, RASTER_LAYERS, VECTOR_LAYERS

log = logging.getLogger("export_worker.gpkg")


def render_gpkg(ctx: RenderContext) -> Path:
    if not ctx.is_composite:
        raise RenderError("GeoPackage exports are always single-file (composite)")

    job = ctx.primary_job
    dst = ctx.work_dir / "topo.gpkg"
    if dst.exists():
        dst.unlink()

    raster_layers = [l for l in ctx.layers if l in RASTER_LAYERS]
    vector_layers = [l for l in ctx.layers if l in VECTOR_LAYERS]

    # Vector tables first — `-update` lets later commands append.
    first_write = True
    for layer in vector_layers:
        src = ctx.geojson_path(job["id"], layer)
        table = "contours_5m" if layer == "contours" else "osm_features"
        cmd = ["ogr2ogr", "-f", "GPKG"]
        if first_write:
            first_write = False
        else:
            cmd.append("-update")
        cmd += ["-nln", table, str(dst), str(src)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RenderError(f"ogr2ogr GPKG ({layer}) failed:\n{result.stderr.strip()}")

    # Raster pyramid: composite the selected raster layers into a single tile
    # set, then translate into the GPKG with the GPKG GDAL driver
    # (`-of GPKG` + RASTER_TABLE creation option appends the pyramid).
    if raster_layers:
        from .tile_compose import composite_raster_cogs
        composite_tif = composite_raster_cogs(ctx, raster_layers)
        cmd = [
            "gdal_translate",
            "-of", "GPKG",
            "-co", "RASTER_TABLE=topo_composite",
            "-co", "APPEND_SUBDATASET=YES" if not first_write else "APPEND_SUBDATASET=NO",
            str(composite_tif),
            str(dst),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RenderError(
                f"gdal_translate GPKG raster ({', '.join(raster_layers)}) failed:\n{result.stderr.strip()}"
            )

    if not dst.exists():
        raise RenderError("GPKG produced no output file (no layers selected?)")
    return dst
