"""Shared test helper: stub native libraries that aren't installed on the host.

``pipeline.py`` imports ``osgeo`` (GDAL) at module top and calls
``gdal.UseExceptions()`` / ``ogr.UseExceptions()`` at import time. Those native
bindings are only present inside the worker Docker image, not on a typical dev
host. The pure-Python functions under test (tile maths, label placement, OSM
classification, MBTiles schema, ZIP safety, PDAL pipeline JSON construction,
PIL/numpy tile rendering) don't actually touch GDAL, so we replace the missing
``osgeo`` package with a MagicMock. This lets the pure-logic suites run on the
host AND unchanged inside Docker (where the real module imports fine and the
stub is never applied).

Import this module BEFORE importing ``pipeline``.
"""
import sys
from unittest import mock


def stub_missing(module_name: str) -> None:
    """Install a MagicMock for ``module_name`` only if it can't be imported.

    Tests that need the *real* native library (e.g. test_tile_compose runs an
    actual GDAL Warp) detect the stub with ``isinstance(gdal, MagicMock)`` and
    skip on the host, while still running for real inside Docker.
    """
    try:
        __import__(module_name)
    except Exception:  # noqa: BLE001 - any import failure means "not available"
        sys.modules[module_name] = mock.MagicMock()


def is_stubbed(module_name: str) -> bool:
    """True if ``module_name`` is currently a MagicMock stub (native dep absent)."""
    return isinstance(sys.modules.get(module_name), mock.MagicMock)


# Only osgeo is routinely missing on dev hosts; numpy/PIL/requests/shapely are
# pip-installable and present. Stub defensively in case the host is leaner.
# Dotted entries cover `from X.Y import …` forms, which fail against a plain
# MagicMock parent (a MagicMock is not a package); parents are listed first.
# boto3/psycopg2/pmtiles let the worker/export_worker pure-logic suites run on
# hosts without the AWS/DB client libs (inside Docker the real modules import
# and these are no-ops).
for _name in (
    "osgeo",
    "numpy",
    "requests",
    "shapely",
    "shapely.geometry",
    "shapely.ops",
    "PIL",
    "boto3",
    "psycopg2",
    "psycopg2.extras",
    "pmtiles",
    "pmtiles.convert",
):
    stub_missing(_name)
