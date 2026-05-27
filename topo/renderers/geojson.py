"""GeoJSON export (vector layers only)."""

from __future__ import annotations

import logging
import shutil
import zipfile
from pathlib import Path

from .context import RenderContext, RenderError, VECTOR_LAYERS

log = logging.getLogger("export_worker.geojson")


def render_geojson(ctx: RenderContext) -> Path:
    job = ctx.primary_job
    vector_layers = [l for l in ctx.layers if l in VECTOR_LAYERS]
    if not vector_layers:
        raise RenderError("GeoJSON requires at least one vector layer")

    locals_ = []
    for layer in vector_layers:
        src = ctx.geojson_path(job["id"], layer)
        dst_name = "contours_5m.geojson" if layer == "contours" else "osm_features.geojson"
        dst = ctx.work_dir / dst_name
        shutil.copy2(src, dst)
        locals_.append(dst)

    if len(locals_) == 1:
        return locals_[0]

    zip_path = ctx.work_dir / "geojson.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in locals_:
            zf.write(p, arcname=p.name)
    return zip_path
