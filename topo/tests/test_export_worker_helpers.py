"""export_worker.py pure helpers: filesystem-path scrubbing (privacy).

export_worker.py reads required env vars and creates a boto3 client at import
time, so we set placeholder env before importing. boto3/psycopg2 are stubbed by
_native_stub when absent on the host. No GDAL import, so no osgeo stub needed.

Privacy boundary: RenderError messages are user-visible (emailed + shown in the
dialog) and embed raw subprocess stderr from ogr2ogr / gdal_translate /
tippecanoe, which can carry temp dirs (/tmp/export_*) and internal paths.
_scrub_paths must remove those while keeping the human-readable prefix.
"""
import os
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
os.environ.setdefault("EXPORT_JOB_ID", "export-123")

try:
    from export_worker import _scrub_paths  # noqa: E402
    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc


@unittest.skipUnless(_IMPORT_OK, lambda: f"export_worker import failed: {_IMPORT_ERR}")
class TestScrubPaths(unittest.TestCase):
    def test_strips_temp_dir_keeps_prefix(self):
        msg = "tippecanoe (features) failed: error writing /tmp/export_abc/foo.tif: no space"
        scrubbed = _scrub_paths(msg)
        self.assertNotIn("/tmp/export_abc", scrubbed)
        self.assertIn("tippecanoe (features) failed:", scrubbed)
        self.assertIn("<path>", scrubbed)

    def test_strips_internal_app_path(self):
        msg = "ogr2ogr GPX conversion failed: /app/work/x.geojson not found"
        scrubbed = _scrub_paths(msg)
        self.assertNotIn("/app/work", scrubbed)
        self.assertIn("ogr2ogr GPX conversion failed:", scrubbed)
        self.assertIn("not found", scrubbed)

    def test_leaves_path_free_message_untouched(self):
        msg = "None of the selected layers have data for this job."
        self.assertEqual(_scrub_paths(msg), msg)


if __name__ == "__main__":
    unittest.main()
