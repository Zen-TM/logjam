"""GeoTIFF export.

Per-layer is a direct copy of the stored COG (cheap, no rendering needed).
Composite mosaics the per-layer COGs via gdal.Warp using alpha-respecting
blending — vectors are baked into the composite via the tile compositor and
then translated back to a COG. Vector-only selections are rejected upstream
in the API validator (EXPORT_FORMAT_RULES.geotiff.allowVector = false).
"""

from __future__ import annotations

import logging
import shutil
import zipfile
from pathlib import Path

from .context import RenderContext, RenderError, RASTER_LAYERS

log = logging.getLogger("export_worker.geotiff")


def render_geotiff(ctx: RenderContext) -> Path:
    job = ctx.primary_job
    raster_layers = [l for l in ctx.layers if l in RASTER_LAYERS]
    if not raster_layers:
        raise RenderError("GeoTIFF requires at least one raster layer")

    if ctx.is_composite:
        from .tile_compose import render_composite_to_geotiff
        return render_composite_to_geotiff(ctx, raster_layers)

    # Per-layer: copy each COG into the working dir and ZIP if more than one.
    locals_ = []
    for layer in raster_layers:
        src = ctx.cog_path(job["id"], layer)
        dst = ctx.work_dir / f"{layer}.tif"
        shutil.copy2(src, dst)
        locals_.append(dst)

    if len(locals_) == 1:
        return locals_[0]

    zip_path = ctx.work_dir / "geotiffs.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in locals_:
            zf.write(p, arcname=p.name)
    return zip_path
