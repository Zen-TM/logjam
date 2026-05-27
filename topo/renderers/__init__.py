"""
Export renderers — one module per output format.

Each render_* function takes a RenderContext and returns the local Path of
the produced artefact. The export worker uploads that file to S3 under
exports/<exportJobId>/<filename>. All renderers raise RenderError for
user-visible failures so the worker can surface a clean error message.
"""

from .context import RenderContext, RenderError
from .mbtiles import render_mbtiles
from .geotiff import render_geotiff
from .gpkg import render_gpkg
from .geojson import render_geojson
from .gpx import render_gpx

__all__ = [
    "RenderContext",
    "RenderError",
    "render_mbtiles",
    "render_geotiff",
    "render_gpkg",
    "render_geojson",
    "render_gpx",
]
