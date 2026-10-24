"""export_worker.py pure helpers: what a failed export tells its owner, and
that an area export's box stays out of the log.

export_worker.py reads required env vars and creates a boto3 client at import
time, so we set placeholder env before importing. boto3/psycopg2 are stubbed by
_native_stub when absent on the host.

Privacy boundary: a RenderError's message embeds raw subprocess stderr from
ogr2ogr / gdal_translate / tippecanoe, which carries temp dirs (/tmp/export_*)
and internal paths. The owner reads `failure_sentence` in both clients and in
the email, and it never holds the exception's text.
Mutation that turns this red: return `str(error)` from `failure_sentence`.
"""

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

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
    import export_worker  # noqa: E402
    from area_export import AreaOutsideNsw  # noqa: E402
    from export_worker import GENERIC_FAILURE, failure_sentence  # noqa: E402
    from renderers.context import ExportTooLarge, RenderError  # noqa: E402

    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc


@unittest.skipUnless(_IMPORT_OK, lambda: f"export_worker import failed: {_IMPORT_ERR}")
class TestFailureSentence(unittest.TestCase):
    def test_a_render_failure_shows_none_of_its_stderr(self):
        error = RenderError(
            "tippecanoe (features) failed:\nerror writing /tmp/export_abc/foo.tif"
        )
        self.assertEqual(failure_sentence(error), GENERIC_FAILURE)

    def test_an_unexpected_failure_shows_none_of_itself(self):
        self.assertEqual(
            failure_sentence(OSError("/app/work/x.geojson not found")),
            GENERIC_FAILURE,
        )

    def test_too_large_says_what_to_do(self):
        sentence = failure_sentence(ExportTooLarge("would generate over 9 map tiles"))
        self.assertIn("smaller", sentence)
        self.assertNotIn("tiles", sentence)

    # Mutation: map an AreaExportError to GENERIC_FAILURE whatever it is, and
    # a box in Victoria reads as a fault worth retrying.
    def test_outside_nsw_says_what_to_do(self):
        self.assertEqual(
            failure_sentence(AreaOutsideNsw("no heights tiles in the box")),
            AreaOutsideNsw.SENTENCE,
        )


@unittest.skipUnless(_IMPORT_OK, lambda: f"export_worker import failed: {_IMPORT_ERR}")
class TestAreaBoxNeverLogged(unittest.TestCase):
    # Mutation: put `bbox` in render_area_export's log line, and an export's
    # box (where someone means to go) is in the worker's log.
    def test_the_box_is_in_no_log_line(self):
        row = {
            "bbox": {
                "west": 150.123457,
                "south": -33.765432,
                "east": 150.2,
                "north": -33.7,
            },
            "format": "gpkg",
            "layers": ["heights", "contours"],
            "vector_style_snapshot": {},
        }
        with (
            mock.patch.object(export_worker, "render_area") as render,
            mock.patch.object(export_worker, "s3_archives"),
            self.assertLogs("export_worker", level="DEBUG") as logs,
        ):
            export_worker.render_area_export(row, Path("/work"))
        self.assertEqual(
            render.call_args.args[1], (150.123457, -33.765432, 150.2, -33.7)
        )
        for line in logs.output:
            for number in ("150.12", "33.76", "150.2", "33.7"):
                self.assertNotIn(number, line)


if __name__ == "__main__":
    unittest.main()
