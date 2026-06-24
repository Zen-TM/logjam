"""GPX export — features layer only (point + line geometries).

The features GeoJSON mixes Point, LineString and Polygon geometries in one
layer. The GPX driver cannot create a layer of mixed/"unknown" geometry — a
single ogr2ogr pass fails with `ERROR 6: Cannot create GPX layer ... with
unknown geometry type` and aborts the whole layer (it does NOT silently skip
the unsupported geometries). The GPX driver is also create-only — no -update /
-append — so the geometries must be split into separate target layers in ONE
pass.

We build a small OGR VRT exposing two single-geometry layers from the source:
  - points → GPX `waypoints`
  - lines  → GPX `routes`
Polygons (building/area outlines) are dropped: GPX has no polygon geometry.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from .context import RenderContext, RenderError

log = logging.getLogger("export_worker.gpx")


def _build_gpx_vrt(src: Path, work_dir: Path) -> Path:
    """Write an OGR VRT that splits the mixed-geometry features GeoJSON into a
    point layer and a line layer, each a single declared geometry type so the
    GPX driver accepts them. Returns the VRT path."""
    # GDAL names the GeoJSON layer after the file stem.
    layer = src.stem
    vrt = work_dir / "gpx_features.vrt"
    vrt.write_text(
        '<OGRVRTDataSource>\n'
        '  <OGRVRTLayer name="points">\n'
        f'    <SrcDataSource>{src}</SrcDataSource>\n'
        f'    <SrcSQL dialect="OGRSQL">SELECT * FROM "{layer}" '
        "WHERE OGR_GEOMETRY='POINT'</SrcSQL>\n"
        '    <GeometryType>wkbPoint</GeometryType>\n'
        '  </OGRVRTLayer>\n'
        '  <OGRVRTLayer name="lines">\n'
        f'    <SrcDataSource>{src}</SrcDataSource>\n'
        f'    <SrcSQL dialect="OGRSQL">SELECT * FROM "{layer}" '
        "WHERE OGR_GEOMETRY='LINESTRING'</SrcSQL>\n"
        '    <GeometryType>wkbLineString</GeometryType>\n'
        '  </OGRVRTLayer>\n'
        '</OGRVRTDataSource>\n'
    )
    return vrt


def render_gpx(ctx: RenderContext) -> Path:
    job = ctx.primary_job
    # Defence-in-depth: the API validator already enforces that GPX requests
    # include the 'features' layer, so this branch should never reach a user.
    if "features" not in ctx.layers:
        raise RenderError("GPX export requires the 'features' layer")
    # Stage 2 release: contours-as-GPX is rejected upstream
    # (EXPORT_FORMAT_RULES.gpx.allowVector but only features makes sense).

    src = ctx.geojson_path(job["id"], "features")
    vrt = _build_gpx_vrt(src, ctx.work_dir)
    dst = ctx.work_dir / "features.gpx"

    cmd = [
        "ogr2ogr",
        "-f", "GPX",
        str(dst),
        str(vrt),
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
