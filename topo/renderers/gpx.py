"""GPX export — features layer only (line + point geometries).

GPX has no concept of polygons, so building outlines are dropped (the
features GeoJSON contains polygon geometries for buildings + areas). ogr2ogr
silently skips unsupported geometries with the GPX driver — we don't
explicitly filter, the driver does it for us.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from .context import RenderContext, RenderError

log = logging.getLogger("export_worker.gpx")


def render_gpx(ctx: RenderContext) -> Path:
    job = ctx.primary_job
    # Defence-in-depth: the API validator already enforces that GPX requests
    # include the 'features' layer, so this branch should never reach a user.
    if "features" not in ctx.layers:
        raise RenderError("GPX export requires the 'features' layer")
    # Stage 2 release: contours-as-GPX is rejected upstream
    # (EXPORT_FORMAT_RULES.gpx.allowVector but only features makes sense).

    src = ctx.geojson_path(job["id"], "features")
    dst = ctx.work_dir / "features.gpx"

    cmd = [
        "ogr2ogr",
        "-f", "GPX",
        str(dst),
        str(src),
        "-dsco", "GPX_USE_EXTENSIONS=YES",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RenderError(
            "ogr2ogr GPX conversion failed:\n"
            + result.stderr.strip()
        )
    if not dst.exists():
        raise RenderError("ogr2ogr exited 0 but produced no GPX file")
    return dst
