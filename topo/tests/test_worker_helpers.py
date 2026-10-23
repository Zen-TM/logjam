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
        send_failure_email,
    )
    from email_send import wants_email  # noqa: E402

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


@unittest.skipUnless(
    _IMPORT_OK, f"worker import failed: {globals().get('_IMPORT_ERR', '?')}"
)
class TestSafeErrorMessage(unittest.TestCase):
    # The owner reads this in both clients (shared/DESIGN.md §11): no tool's
    # name, no id. Which step failed is in CloudWatch.
    def test_a_failed_step_names_no_tool_and_no_id(self):
        for error in (
            subprocess.CalledProcessError(1, "pdal"),
            RuntimeError("tippecanoe blew up"),
            RuntimeError("pipeline.py exited with code 1"),
            ValueError("???"),
        ):
            msg = safe_error_message(error)
            self.assertEqual(msg, worker.GENERIC_FAILURE)
            self.assertNotIn(worker.JOB_ID, msg)
            self.assertNotRegex(msg, r"subprocess|pipeline|tippecanoe|tiles")

    def test_memory_error(self):
        # One sentence, declared once, for an area too big for memory: an
        # out-of-memory kill here, and sharpen.py's refusal in advance.
        from worker_common import TOO_BIG

        self.assertEqual(safe_error_message(MemoryError()), TOO_BIG)
        self.assertEqual(safe_error_message(RuntimeError("exit code -9")), TOO_BIG)

    def test_os_error_points_at_input(self):
        self.assertIn("LiDAR data", safe_error_message(OSError("bad zip")))


@unittest.skipUnless(
    _IMPORT_OK, f"worker import failed: {globals().get('_IMPORT_ERR', '?')}"
)
class TestMergeSettings(unittest.TestCase):
    def test_none_inputs_fall_back_to_vector_defaults(self):
        merged = merge_settings(None, None)
        self.assertEqual(merged["contours"], worker.VECTOR_STYLE_DEFAULTS["contours"])
        self.assertEqual(merged["features"]["enabled"], True)
        self.assertEqual(
            merged["features"]["features"], worker.VECTOR_STYLE_DEFAULTS["features"]
        )

    def test_raster_layers_pass_through_when_present(self):
        merged = merge_settings({"hillshade": {"azimuth": 315}, "slope": {"x": 1}}, {})
        self.assertEqual(merged["hillshade"], {"azimuth": 315})
        self.assertEqual(merged["slope"], {"x": 1})
        self.assertNotIn("vegetation", merged)  # None values dropped

    def test_features_enabled_taken_from_raster_options(self):
        merged = merge_settings({"features": {"enabled": False}}, None)
        self.assertFalse(merged["features"]["enabled"])

    def test_vector_style_contours_override(self):
        vec = {
            "contours": {
                "majorColour": "#111111ff",
                "minorColour": "#222222ff",
                "majorWidthM": 5,
                "minorWidthM": 2,
            }
        }
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


@unittest.skipUnless(
    _IMPORT_OK, f"worker import failed: {globals().get('_IMPORT_ERR', '?')}"
)
class TestWantsEmail(unittest.TestCase):
    def test_missing_user_returns_false(self):
        self.assertFalse(wants_email(_FakeConn(None), "u1", "topoEmail"))

    def test_no_prefs_defaults_true(self):
        self.assertTrue(
            wants_email(_FakeConn({"ui_preferences": None}), "u1", "topoEmail")
        )

    def test_no_notifications_key_defaults_true(self):
        self.assertTrue(
            wants_email(
                _FakeConn({"ui_preferences": {"themeSchemeId": "x"}}), "u1", "topoEmail"
            )
        )

    def test_explicit_false_is_respected(self):
        row = {"ui_preferences": {"notifications": {"exportEmail": False}}}
        self.assertFalse(wants_email(_FakeConn(row), "u1", "exportEmail"))

    def test_explicit_true_is_respected(self):
        row = {"ui_preferences": {"notifications": {"geoPdfEmail": True}}}
        self.assertTrue(wants_email(_FakeConn(row), "u1", "geoPdfEmail"))

    def test_non_bool_value_defaults_true(self):
        row = {"ui_preferences": {"notifications": {"topoEmail": "yes"}}}
        self.assertTrue(wants_email(_FakeConn(row), "u1", "topoEmail"))

    def test_missing_specific_key_defaults_true(self):
        # exportEmail absent while another key is present → default true.
        row = {"ui_preferences": {"notifications": {"topoEmail": False}}}
        self.assertTrue(wants_email(_FakeConn(row), "u1", "exportEmail"))


@unittest.skipUnless(
    _IMPORT_OK, f"worker import failed: {globals().get('_IMPORT_ERR', '?')}"
)
class TestSendFailureEmail(unittest.TestCase):
    """A reaped/failed topo job must mail its owner. Captures the send_email call
    instead of sending."""

    def setUp(self):
        self.sent = []
        self._saved_send = worker.send_email
        self._saved_url = worker.FRONTEND_URL
        worker.send_email = lambda *args: self.sent.append(args)

    def tearDown(self):
        worker.send_email = self._saved_send
        worker.FRONTEND_URL = self._saved_url

    def test_sends_subject_error_and_deep_link(self):
        worker.FRONTEND_URL = "https://logjam.example/"
        send_failure_email("alice@example.com", "job-9", "Ran out of memory.")
        self.assertEqual(len(self.sent), 1)
        to_email, subject, text, html = self.sent[0]
        self.assertEqual(to_email, "alice@example.com")
        self.assertEqual(subject, "Topo map failed — Logjam")
        self.assertIn("Ran out of memory.", text)
        # Trailing slash on FRONTEND_URL must not double up in the link.
        self.assertIn("https://logjam.example/?topoJob=job-9", text)
        self.assertIn("https://logjam.example/?topoJob=job-9", html)
        # Same logo-header shape as the completion mail.
        self.assertIn("email-logo-lockup.png", html)
        self.assertIn("<strong>Ran out of memory.</strong>", html)

    def test_no_frontend_url_skips_send(self):
        worker.FRONTEND_URL = ""
        send_failure_email("alice@example.com", "job-9", "boom")
        self.assertEqual(self.sent, [])


@unittest.skipUnless(
    _IMPORT_OK, f"worker import failed: {globals().get('_IMPORT_ERR', '?')}"
)
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


@unittest.skipUnless(
    _IMPORT_OK, f"worker import failed: {globals().get('_IMPORT_ERR', '?')}"
)
class TestProcessSharpen(unittest.TestCase):
    """A job the API marked to sharpen runs sharpen.py, not the legacy
    pipeline, and its mark becomes the result.

    Mutations that turn it red: process_job ignoring `job["sharpen"]` (the
    legacy pipeline runs), the archives' keys left out of the result, the
    vegetation tick ignored, a missing contour archive uploaded anyway (or
    failing the job), and exit 2 reported as the generic failure instead of
    sharpen.py's sentence.
    """

    def run_job(self, mark, write):
        import tempfile
        from pathlib import Path
        from unittest import mock

        job = {"id": "job-1", "s3_input_key": "inputs/job-1/a.zip", "sharpen": mark}

        def fake_run(cmd, job_id, progress_path):
            out = Path(cmd[3])
            out.mkdir(parents=True, exist_ok=True)
            return write(out)

        legacy = mock.Mock(return_value=([{"name": "vegetation"}], None, True, 7, None))
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.object(worker, "s3") as s3,
            mock.patch.object(worker, "run_with_heartbeat", side_effect=fake_run),
            mock.patch.object(worker, "process_legacy", legacy),
        ):
            result = worker.process_job(job, tmp)
            uploads = [c.args[2] for c in s3.upload_file.call_args_list]
        return result, uploads, legacy

    @staticmethod
    def finished(out):
        import json

        (out / "sharpen.json").write_text(json.dumps({"v": 1, "zmax": 16}))
        for name in ("heights", "slope", "contours"):
            (out / f"{name}.pmtiles").write_bytes(b"x" * 10)
        return 0

    def test_the_mark_becomes_the_result(self):
        result, uploads, legacy = self.run_job(
            {"v": 1, "vegetation": False}, self.finished
        )
        output_keys, _, osm_failed, total, _, sharpen = result
        legacy.assert_not_called()
        self.assertEqual(output_keys, [])
        self.assertFalse(osm_failed)
        self.assertEqual(total, 30)
        self.assertEqual(sharpen["zmax"], 16)
        self.assertFalse(sharpen["vegetation"])
        self.assertEqual(
            sharpen["keys"],
            {n: f"outputs/job-1/{n}.pmtiles" for n in ("heights", "slope", "contours")},
        )
        self.assertEqual(sorted(uploads), sorted(sharpen["keys"].values()))

    def test_a_ticked_job_gets_the_legacy_vegetation_layer(self):
        result, _, legacy = self.run_job({"v": 1, "vegetation": True}, self.finished)
        output_keys, _, _, total, _, sharpen = result
        self.assertEqual(legacy.call_args.kwargs, {"layers": "vegetation"})
        self.assertEqual(output_keys, [{"name": "vegetation"}])
        self.assertEqual(total, 37)
        self.assertTrue(sharpen["vegetation"])

    def test_no_contour_archive_is_left_out(self):
        import json

        def no_contours(out):
            (out / "sharpen.json").write_text(json.dumps({"v": 1, "zmax": 16}))
            for name in ("heights", "slope"):
                (out / f"{name}.pmtiles").write_bytes(b"x" * 10)
            return 0

        result, uploads, _ = self.run_job({"v": 1, "vegetation": False}, no_contours)
        self.assertEqual(sorted(result[-1]["keys"]), ["heights", "slope"])
        self.assertEqual(len(uploads), 2)

    def test_a_zip_it_cannot_sharpen_says_why(self):
        import json

        def refused(out):
            (out / "error.json").write_text(json.dumps({"sentence": "Add the DEM."}))
            return 2

        with self.assertRaises(worker.JobInputError) as ctx:
            self.run_job({"v": 1, "vegetation": False}, refused)
        self.assertEqual(safe_error_message(ctx.exception), "Add the DEM.")

    def test_a_crash_is_the_generic_failure(self):
        with self.assertRaises(RuntimeError) as ctx:
            self.run_job({"v": 1, "vegetation": False}, lambda out: 1)
        self.assertEqual(safe_error_message(ctx.exception), worker.GENERIC_FAILURE)

    def test_an_unmarked_job_runs_the_legacy_pipeline(self):
        result, _, legacy = self.run_job(None, self.finished)
        legacy.assert_called_once()
        self.assertEqual(legacy.call_args.kwargs, {})
        self.assertIsNone(result[-1])


if __name__ == "__main__":
    unittest.main()
