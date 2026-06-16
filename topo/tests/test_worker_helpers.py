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
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_NAME", "test")
os.environ.setdefault("DB_USER", "test")
os.environ.setdefault("DB_PASSWORD", "test")
os.environ.setdefault("JOB_ID", "job-123")

try:
    import worker  # noqa: E402
    from worker import (  # noqa: E402
        compose_database_url,
        merge_settings,
        safe_error_message,
        wants_topo_email,
    )
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

    def test_label_scale_passthrough(self):
        merged = merge_settings(None, {"labelScale": 1.5})
        self.assertEqual(merged["labelScale"], 1.5)

    def test_label_scale_defaults_when_absent(self):
        # Vector styles snapshotted before labelScale existed omit it → default 1.
        merged = merge_settings(None, {"contours": {}})
        self.assertEqual(merged["labelScale"], 1)


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


@unittest.skipUnless(_IMPORT_OK, f"worker import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestComposeDatabaseUrl(unittest.TestCase):
    def setUp(self):
        self._saved = {
            k: os.environ.get(k)
            for k in ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD")
        }

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_url_encodes_special_characters(self):
        os.environ["DB_HOST"] = "db.example.com"
        os.environ["DB_PORT"] = "5432"
        os.environ["DB_NAME"] = "logjam"
        os.environ["DB_USER"] = "logjam_admin"
        os.environ["DB_PASSWORD"] = "p@ss!w0rd#"
        url = compose_database_url()
        self.assertEqual(
            url,
            "postgresql://logjam_admin:p%40ss%21w0rd%23@db.example.com:5432/logjam",
        )

    def test_default_port(self):
        os.environ["DB_HOST"] = "localhost"
        os.environ.pop("DB_PORT", None)
        os.environ["DB_NAME"] = "logjam"
        os.environ["DB_USER"] = "logjam"
        os.environ["DB_PASSWORD"] = "logjam"
        url = compose_database_url()
        self.assertIn(":5432/logjam", url)

    def test_missing_vars_lists_names_only(self):
        os.environ.pop("DB_HOST", None)
        os.environ.pop("DB_NAME", None)
        os.environ["DB_USER"] = "u"
        os.environ["DB_PASSWORD"] = "secret-value"
        with self.assertRaises(RuntimeError) as ctx:
            compose_database_url()
        msg = str(ctx.exception)
        self.assertIn("DB_HOST", msg)
        self.assertIn("DB_NAME", msg)
        self.assertNotIn("secret-value", msg)


if __name__ == "__main__":
    unittest.main()
