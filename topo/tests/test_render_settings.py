"""Tests for the render-settings loader in pipeline.py.

Defaults must match the expected values used by the render and gdaldem call sites.

Plain unittest (no pytest dep) so it runs in the worker Docker image as-is.
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# This test only exercises pure-Python settings code, but pipeline.py
# imports GDAL/PDAL/shapely at module top. When those aren't installed
# (running pytest on the host instead of inside the worker Docker image),
# skip the suite cleanly rather than erroring at import time.
try:
    from pipeline import (
        _default_render_settings,
        _parse_rgba_hex,
        load_render_settings,
    )

    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc


@unittest.skipUnless(
    _IMPORT_OK,
    f"pipeline import failed (missing native deps): {globals().get('_IMPORT_ERR', '?')}",
)
class TestRenderSettings(unittest.TestCase):
    def setUp(self):
        self.default = _default_render_settings
        self.parse = _parse_rgba_hex
        self.load = load_render_settings

    def test_defaults_match_legacy_hillshade(self):
        s = self.default()
        self.assertEqual(s["hillshade"]["azimuth"], 315)
        self.assertEqual(s["hillshade"]["altitude"], 45)
        self.assertEqual(s["hillshade"]["zFactor"], 1.5)
        self.assertFalse(s["hillshade"]["multidirectional"])
        self.assertTrue(s["hillshade"]["enabled"])

    def test_defaults_match_legacy_slope_bands(self):
        s = self.default()
        bands = s["slope"]["bands"]
        self.assertEqual([b["fromDeg"] for b in bands], [40, 50, 60, 70])
        self.assertEqual([b["toDeg"] for b in bands], [50, 60, 70, 90])

    def test_defaults_match_legacy_vegetation(self):
        s = self.default()
        self.assertEqual(s["vegetation"]["minRatio"], 0.05)
        self.assertEqual(s["vegetation"]["maxRatio"], 0.45)
        self.assertEqual(s["vegetation"]["alphaMin"], 60)
        self.assertEqual(s["vegetation"]["alphaMax"], 255)
        self.assertTrue(s["vegetation"]["weightsEnabled"])
        self.assertIn("Heathlands", s["vegetation"]["formationWeights"])
        self.assertEqual(s["vegetation"]["formationWeights"]["Heathlands"], 1.8)

    def test_defaults_match_legacy_contours(self):
        s = self.default()
        zbs = s["contours"]["zoomBands"]
        self.assertEqual(len(zbs), 3)
        self.assertEqual(
            (zbs[0]["zoomMin"], zbs[0]["zoomMax"], zbs[0]["intervalM"]), (12, 15, 50)
        )
        self.assertEqual(
            (zbs[1]["zoomMin"], zbs[1]["zoomMax"], zbs[1]["intervalM"]), (15, 16, 10)
        )
        self.assertEqual(
            (zbs[2]["zoomMin"], zbs[2]["zoomMax"], zbs[2]["intervalM"]), (17, 18, 5)
        )
        self.assertEqual(s["contours"]["majorWidthM"], 18)
        self.assertEqual(s["contours"]["minorWidthM"], 8)

    def test_defaults_include_all_osm_features(self):
        s = self.default()
        feats = s["features"]["features"]
        for key in (
            "waterway",
            "track",
            "road",
            "building",
            "power",
            "campsite",
            "peak",
            "spring",
            "gate",
            "cave",
            "bridge",
            "ford",
            "waterfall",
            "trailhead",
            "viewpoint",
            "hut",
        ):
            self.assertIn(key, feats, f"missing OSM feature default: {key}")
        for new_key in ("bridge", "ford", "waterfall", "trailhead", "viewpoint", "hut"):
            self.assertFalse(feats[new_key]["enabled"], f"{new_key} should default off")

    def test_load_settings_none_returns_defaults(self):
        self.assertEqual(self.load(None), self.default())

    def test_load_settings_roundtrip(self):
        defaults = self.default()
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(defaults, f)
            path = f.name
        try:
            self.assertEqual(self.load(path), defaults)
        finally:
            os.unlink(path)

    # Red if the job's file can change a layer other than vegetation, the one
    # layer the pipeline renders.
    def test_load_settings_takes_only_vegetation(self):
        job = self.default()
        job["vegetation"]["alphaMin"] = 10
        job["slope"]["enabled"] = False
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(job, f)
            path = f.name
        try:
            loaded = self.load(path)
        finally:
            os.unlink(path)
        self.assertEqual(loaded["vegetation"]["alphaMin"], 10)
        self.assertEqual(loaded["slope"], self.default()["slope"])

    def test_load_settings_rejects_invalid_hex(self):
        bad = self.default()
        bad["vegetation"]["sparseColour"] = "#zzz"
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(bad, f)
            path = f.name
        try:
            with self.assertRaises(ValueError):
                self.load(path)
        finally:
            os.unlink(path)

    def test_parse_rgba_hex_endpoints(self):
        self.assertEqual(self.parse("#00000000"), (0, 0, 0, 0))
        self.assertEqual(self.parse("#ffffffff"), (255, 255, 255, 255))
        with self.assertRaises(ValueError):
            self.parse("#fff")


if __name__ == "__main__":
    unittest.main()
