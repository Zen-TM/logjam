"""
Export renderers — one module per output format.

Each render_* function takes a RenderContext and returns the local Path of
the produced artefact. The export worker uploads that file to S3 under
exports/<exportJobId>/<filename>. A renderer that fails raises RenderError,
with a message for the log; the worker writes what the owner reads.
"""

from .context import ExportTooLarge, RenderContext, RenderError
from .mbtiles import render_mbtiles
from .geotiff import render_geotiff
from .gpkg import render_gpkg

__all__ = [
    "ExportTooLarge",
    "RenderContext",
    "RenderError",
    "render_mbtiles",
    "render_geotiff",
    "render_gpkg",
]
