"""worker.py pure helpers: error mapping, settings merge, email-preference read.

worker.py reads required env vars and creates a boto3 client at import time, so
we set placeholder env before importing. It does not import GDAL, so no osgeo
stub is needed for this module; boto3/psycopg2/pmtiles are stubbed by
_native_stub when absent on the host.
"""
import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402

os.environ.setdefault("S3_BUCKET_TOPO", "test-bucket")
os.environ.setdefault("DATABASE_URL", "postg:///test")
os.environ.setdefault("JOB_ID", "job-123")

try:
    import worker  # noqa: E402
    from worker import merge_settings, safe_error_message, wants_topo_email  # noqa: E402
    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc


class _FakeCursor:
    def __init__(self, row):
        self._row = row

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, *args, **kwargs):
        pass

    def fetchone(self):
        return self._row


class _FakeConn:
    def __init__(self, row):
        self._row = row

    def cursor(self):
        return _FakeCursor(self._row)


@unittest.skipUnless(_IMPORT_OK, f"worker import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestSafeErrorMessage(unittest.TestCase):
    def test_called_process_error_is_generic_with_job_id(self):
        msg = safe_error_message(subprocess.CalledProcessError(1, "pdal"))
        self.assertIn("subprocess failed", msg)
        self.assertIn(worker.JOB_ID, msg)

    def test_memory_error(self):
        self.assertIn("out of memory", safe_error_message(MemoryError()))
        self.assertIn("out of memory", safe_error_message(RuntimeError("exit code -9")))

    def test_tippecanoe_runtime_error(self):
        self.assertIn("vector tiles", safe_error_message(RuntimeError("tippecanoe blew up")))

    def test_topo_mbtiles_runtime_error(self):
        self.assertIn("topo pipeline", safe_error_message(RuntimeError("topo_mbtiles crashed")))

    def test_os_error_points_at_input(self):
        self.assertIn("input LiDAR", safe_error_message(OSError("bad zip")))

    def test_unknown_error_is_generic(self):
        self.assertIn("Processing failed", safe_error_message(ValueError("???")))


@unittest.skipUnless(_IMPORT_OK, f"worker import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestMergeSettings(unittest.TestCase):
    def test_none_inputs_fall_back_to_vector_defaults(self):
        merged = merge_settings(None, None)
        self.assertEqual(merged["contours"], worker.VECTOR_STYLE_DEFAULTS["contours"])
        self.assertEqual(merged["features"]["enabled"], True)
        self.assertEqual(merged["features"]["features"], worker.VECTOR_STYLE_DEFAULTS["features"])

    def test_raster_layers_pass_through_when_present(self):
        merged = merge_settings({"hillshade": {"azimuth": 315}, "slope": {"x": 1}}, {})
        self.assertEqual(merged["hillshade"], {"azimuth": 315})
        self.assertEqual(merged["slope"], {"x": 1})
        self.assertNotIn("vegetation", merged)  # None values dropped

    def test_features_enabled_taken_from_raster_options(self):
        merged = merge_settings({"features": {"enabled": False}}, None)
        self.assertFalse(merged["features"]["enabled"])

    def test_vector_style_contours_override(self):
        vec = {"contours": {"majorColour": "#111111ff", "minorColour": "#222222ff",
                            "majorWidthM": 5, "minorWidthM": 2}}
        merged = merge_settings({"contours": {"zoomBands": [1, 2, 3]}}, vec)
        self.assertEqual(merged["contours"]["majorColour"], "#111111ff")
        # raster contour fields are preserved alongside vector style.
        self.assertEqual(merged["contours"]["zoomBands"], [1, 2, 3])


@unittest.skipUnless(_IMPORT_OK, f"worker import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestWantsTopoEmail(unittest.TestCase):
    def test_missing_user_returns_false(self):
        self.assertFalse(wants_topo_email(_FakeConn(None), "u1"))

    def test_no_prefs_defaults_true(self):
        self.assertTrue(wants_topo_email(_FakeConn({"ui_preferences": None}), "u1"))

    def test_no_notifications_key_defaults_true(self):
        self.assertTrue(wants_topo_email(_FakeConn({"ui_preferences": {"themeSchemeId": "x"}}), "u1"))

    def test_explicit_false_is_respected(self):
        row = {"ui_preferences": {"notifications": {"topoEmail": False}}}
        self.assertFalse(wants_topo_email(_FakeConn(row), "u1"))

    def test_explicit_true_is_respected(self):
        row = {"ui_preferences": {"notifications": {"topoEmail": True}}}
        self.assertTrue(wants_topo_email(_FakeConn(row), "u1"))

    def test_non_bool_value_defaults_true(self):
        row = {"ui_preferences": {"notifications": {"topoEmail": "yes"}}}
        self.assertTrue(wants_topo_email(_FakeConn(row), "u1"))


if __name__ == "__main__":
    unittest.main()
