"""Tests for the GPX renderer in renderers/gpx.py.

The features GeoJSON mixes Point, LineString and Polygon in one layer. A naive
single-pass `ogr2ogr -f GPX` fails (`ERROR 6: Cannot create GPX layer ... with
unknown geometry type`). render_gpx must split the geometries into a VRT and
emit waypoints (points) + routes (lines), dropping polygons.

Runs a real ogr2ogr subprocess + GDAL, so it is skipped when osgeo is the host
stub and runs for real inside the worker Docker image.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402  (stubs osgeo when absent on the host)

_REAL_GDAL = not _native_stub.is_stubbed("osgeo")

if _REAL_GDAL:
    from osgeo import gdal  # noqa: E402
    gdal.UseExceptions()

from renderers.context import RenderContext  # noqa: E402
from renderers.gpx import render_gpx  # noqa: E402


_MIXED_FEATURES = {
    "type": "FeatureCollection",
    "features": [
        {"type": "Feature",
         "geometry": {"type": "Point", "coordinates": [150.30, -33.70]},
         "properties": {"name": "Peak X", "_category": "peak"}},
        {"type": "Feature",
         "geometry": {"type": "LineString",
                      "coordinates": [[150.30, -33.70], [150.31, -33.71], [150.32, -33.70]]},
         "properties": {"name": "Track Y", "_category": "track"}},
        {"type": "Feature",
         "geometry": {"type": "Polygon",
                      "coordinates": [[[150.30, -33.70], [150.31, -33.70],
                                       [150.31, -33.71], [150.30, -33.71],
                                       [150.30, -33.70]]]},
         "properties": {"name": "Lake Z", "_category": "water"}},
    ],
}


def _make_ctx(work_dir: Path, features: dict) -> RenderContext:
    job_id = "job-1"
    src = work_dir / f"sources_{job_id}_features.geojson"
    src.write_text(json.dumps(features))
    ctx = RenderContext(
        s3=None,
        bucket="test-bucket",
        work_dir=work_dir,
        source_jobs=[{"id": job_id}],
        layers=["features"],
        bundling="per-layer",
        vector_style={},
    )
    # Pre-seed the download cache so geojson_path() returns the local file.
    ctx._geojson_paths[f"{job_id}/features.geojson"] = src
    return ctx


def _layer_feature_count(gpx_path: Path, layer_name: str) -> int:
    ds = gdal.OpenEx(str(gpx_path))
    layer = ds.GetLayerByName(layer_name)
    count = layer.GetFeatureCount() if layer is not None else -1
    ds = None
    return count


@unittest.skipUnless(_REAL_GDAL, "real GDAL/ogr2ogr required (host has no osgeo)")
class TestRenderGpx(unittest.TestCase):
    def test_mixed_geometry_splits_into_waypoints_and_routes(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            ctx = _make_ctx(work, _MIXED_FEATURES)
            out = render_gpx(ctx)
            self.assertTrue(out.exists())
            # Point → waypoints, LineString → routes, Polygon dropped.
            self.assertEqual(_layer_feature_count(out, "waypoints"), 1)
            self.assertEqual(_layer_feature_count(out, "routes"), 1)

    def test_point_attributes_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            ctx = _make_ctx(work, _MIXED_FEATURES)
            out = render_gpx(ctx)
            ds = gdal.OpenEx(str(out))
            layer = ds.GetLayerByName("waypoints")
            feat = layer.GetNextFeature()
            name = feat.GetField("name")
            ds = None
            self.assertEqual(name, "Peak X")


if __name__ == "__main__":
    unittest.main()
