"""worker.py pure helpers: error mapping, job processing, email-preference read.

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

import worker  # noqa: E402
from worker import (  # noqa: E402
    compose_database_url,
    safe_error_message,
    send_failure_email,
)
from email_send import wants_email  # noqa: E402


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

    # There is no support to contact. Mutation: put "contact support" back in
    # GENERIC_FAILURE.
    def test_the_generic_sentence_sends_no_one_to_support(self):
        self.assertNotIn("support", worker.GENERIC_FAILURE.lower())

    def test_memory_error(self):
        # One sentence, declared once, for an area too big for memory: an
        # out-of-memory kill here, and sharpen.py's refusal in advance.
        from worker_common import TOO_BIG

        self.assertEqual(safe_error_message(MemoryError()), TOO_BIG)
        self.assertEqual(safe_error_message(RuntimeError("exit code -9")), TOO_BIG)

    def test_os_error_points_at_input(self):
        self.assertIn("LiDAR data", safe_error_message(OSError("bad zip")))


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
        row = {"ui_preferences": {"notifications": {"topoEmail": True}}}
        self.assertTrue(wants_email(_FakeConn(row), "u1", "topoEmail"))

    def test_non_bool_value_defaults_true(self):
        row = {"ui_preferences": {"notifications": {"topoEmail": "yes"}}}
        self.assertTrue(wants_email(_FakeConn(row), "u1", "topoEmail"))

    def test_missing_specific_key_defaults_true(self):
        # exportEmail absent while another key is present → default true.
        row = {"ui_preferences": {"notifications": {"topoEmail": False}}}
        self.assertTrue(wants_email(_FakeConn(row), "u1", "exportEmail"))


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


class TestComposeDatabaseUrl(unittest.TestCase):
    def setUp(self):
        self._saved = {
            k: os.environ.get(k)
            for k in (
                "DB_HOST",
                "DB_PORT",
                "DB_NAME",
                "DB_USER",
                "DB_PASSWORD",
                "DATABASE_SSL",
                "DATABASE_SSL_CA",
                "NODE_ENV",
            )
        }
        os.environ.pop("DATABASE_SSL", None)
        os.environ.pop("DATABASE_SSL_CA", None)
        os.environ.pop("NODE_ENV", None)

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_url_encodes_special_characters(self):
        os.environ["DATABASE_SSL"] = "disable"  # the TLS parameters are tested below
        os.environ["DB_HOST"] = "db.example.com"
        os.environ["DB_PORT"] = "5432"
        os.environ["DB_NAME"] = "logjam"
        os.environ["DB_USER"] = "logjam_admin"
        os.environ["DB_PASSWORD"] = "p@ss!w0rd#"
        url = compose_database_url()
        self.assertEqual(
            url,
            "postgresql://logjam_admin:p%40ss%21w0rd%23@db.example.com:5432/logjam"
            f"?{self.HYGIENE}",
        )

    HYGIENE = (
        "connect_timeout=10&keepalives=1&keepalives_idle=30"
        "&keepalives_interval=10&keepalives_count=3"
    )

    def _basic_env(self):
        os.environ["DB_HOST"] = "db"
        os.environ["DB_PORT"] = "5432"
        os.environ["DB_NAME"] = "logjam"
        os.environ["DB_USER"] = "u"
        os.environ["DB_PASSWORD"] = "p"

    # Mutation: default to no certificate again (the `or BRAIN_CA_PATH`), or
    # change the path: a worker with no DATABASE_SSL_CA would connect in the
    # clear.
    def test_unset_ca_verifies_against_the_brains_certificate(self):
        self._basic_env()
        self.assertEqual(
            compose_database_url(),
            f"postgresql://u:p@db:5432/logjam?{self.HYGIENE}"
            "&sslmode=verify-full&sslrootcert=/app/brain-ca.pem",
        )

    # Mutation: drop the sslmode/sslrootcert parameters, or let
    # DATABASE_SSL=disable fall through to them.
    def test_ca_set_verifies_the_server_against_it(self):
        self._basic_env()
        os.environ["DATABASE_SSL_CA"] = "/etc/logjam/brain ca.pem"
        self.assertEqual(
            compose_database_url(),
            f"postgresql://u:p@db:5432/logjam?{self.HYGIENE}"
            "&sslmode=verify-full&sslrootcert=/etc/logjam/brain%20ca.pem",
        )

    def test_ssl_disable_stays_plain_even_with_a_ca(self):
        self._basic_env()
        os.environ["DATABASE_SSL_CA"] = "/etc/logjam/ca.pem"
        os.environ["DATABASE_SSL"] = "disable"
        self.assertEqual(
            compose_database_url(),
            f"postgresql://u:p@db:5432/logjam?{self.HYGIENE}",
        )

    # Mutation: `os.environ.get("DATABASE_SSL_CA", BRAIN_CA_PATH)` in place of
    # the `or`: an empty value is then a certificate named "".
    def test_an_empty_ca_is_unset(self):
        self._basic_env()
        os.environ["DATABASE_SSL_CA"] = ""
        self.assertIn(
            "sslrootcert=/app/brain-ca.pem",
            compose_database_url(),
        )

    # Mutation: drop the NODE_ENV check on DATABASE_SSL=disable in
    # compose_database_url: a production worker then connects in the clear.
    def test_ssl_disable_is_refused_in_production(self):
        self._basic_env()
        os.environ["DATABASE_SSL"] = "disable"
        os.environ["NODE_ENV"] = "production"
        with self.assertRaisesRegex(RuntimeError, "forbidden in production"):
            compose_database_url()

    def test_ssl_disable_stays_plain_without_a_ca(self):
        self._basic_env()
        os.environ["DATABASE_SSL"] = "disable"
        self.assertEqual(
            compose_database_url(),
            f"postgresql://u:p@db:5432/logjam?{self.HYGIENE}",
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


class TestProcessSharpen(unittest.TestCase):
    """A job the API marked to sharpen runs sharpen.py, and its mark becomes
    the result.

    Mutations that turn it red: an unmarked job run instead of refused, the
    archives' keys left out of the result, the vegetation tick ignored, a
    missing contour archive uploaded anyway (or failing the job), and exit 2
    reported as the generic failure instead of sharpen.py's sentence. For a
    pass left out: `except worker.VegetationLeftOut` removed (the job fails),
    or `vegetationLeftOut` left false.
    """

    def run_job(self, mark, write, veg_metrics=None, veg_raises=None):
        import tempfile
        from pathlib import Path
        from unittest import mock

        job = {"id": "job-1", "s3_input_key": "inputs/job-1/a.zip", "sharpen": mark}

        def fake_run(cmd, job_id, progress_path):
            out = Path(cmd[3])
            out.mkdir(parents=True, exist_ok=True)
            return write(out)

        vegetation = mock.Mock(
            return_value=([{"name": "vegetation"}], 7, veg_metrics),
            side_effect=veg_raises,
        )
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.object(worker, "s3") as s3,
            mock.patch.object(worker, "run_with_heartbeat", side_effect=fake_run),
            mock.patch.object(worker, "process_vegetation", vegetation),
        ):
            try:
                result = worker.process_job(job, tmp)
            finally:
                self.downloads = s3.download_file.call_count
            uploads = [c.args[2] for c in s3.upload_file.call_args_list]
        return result, uploads, vegetation

    @staticmethod
    def finished(out):
        import json

        (out / "sharpen.json").write_text(json.dumps({"v": 1, "zmax": 16}))
        for name in ("heights", "slope", "contours"):
            (out / f"{name}.pmtiles").write_bytes(b"x" * 10)
        return 0

    def test_the_mark_becomes_the_result(self):
        result, uploads, vegetation = self.run_job(
            {"v": 1, "vegetation": False}, self.finished
        )
        output_keys, _, total, _, sharpen = result
        vegetation.assert_not_called()
        self.assertEqual(output_keys, [])
        self.assertEqual(total, 30)
        self.assertEqual(sharpen["zmax"], 16)
        self.assertFalse(sharpen["vegetation"])
        self.assertEqual(
            sharpen["keys"],
            {n: f"outputs/job-1/{n}.pmtiles" for n in ("heights", "slope", "contours")},
        )
        self.assertEqual(sorted(uploads), sorted(sharpen["keys"].values()))

    def test_the_stored_result_is_the_example_the_api_reads(self):
        # Mutation: a key or field the worker adds renamed, which the API's
        # parser would read as no area (shared/src/__fixtures__/sharpen-result.json,
        # read by api/src/services/sharpenedAreas.unit.test.ts too).
        import json
        import os

        root = os.path.join(os.path.dirname(__file__), "..", "..")
        path = os.path.join(root, "shared/src/__fixtures__/sharpen-result.json")
        with open(path) as f:
            example = json.load(f)
        stored = example["stored"]
        reported = {
            k: v
            for k, v in stored.items()
            if k not in ("keys", "vegetation", "vegetationLeftOut")
        }

        def finished(out):
            (out / "sharpen.json").write_text(json.dumps(reported))
            for name in stored["keys"]:
                (out / f"{name}.pmtiles").write_bytes(b"x")
            return 0

        self.assertEqual(example["jobId"], "job-1")  # run_job's job id
        result, _, _ = self.run_job({"v": 1, "vegetation": False}, finished)
        self.assertEqual(result[-1], stored)

    def test_the_vegetation_pass_is_charged_with_the_job(self):
        # Mutation: leave the vegetation pass's seconds out, and a ticked
        # job's vegetation runs free (credits are charged from wallSeconds,
        # api/src/lib/computeCredits.ts) while its estimate learns too low.
        import json

        def finished(out):
            (out.parent / "sharpen-metrics.json").write_text(
                json.dumps({"wallSeconds": 13.0})
            )
            return self.finished(out)

        result, _, _ = self.run_job(
            {"v": 1, "vegetation": True},
            finished,
            {"wallSeconds": 40.0, "fireStaleFraction": 0.25},
        )
        metrics = result[3]
        self.assertEqual(metrics["wallSeconds"], 53.0)
        self.assertEqual(metrics["vegetationWallSeconds"], 40.0)
        # Red if the pass's fire reading is dropped: CI reads it to know the
        # worker read the fire raster.
        self.assertEqual(metrics["fireStaleFraction"], 0.25)

    def test_unread_sharpen_metrics_are_not_replaced_by_the_vegetation_pass(self):
        # Mutation: store the vegetation seconds alone when sharpen.py's
        # metrics couldn't be read, and the job is charged for that pass only
        # instead of falling back to its elapsed time.
        result, _, _ = self.run_job(
            {"v": 1, "vegetation": True}, self.finished, {"wallSeconds": 40.0}
        )
        self.assertIsNone(result[3])

    def test_a_ticked_job_gets_the_vegetation_layer(self):
        result, _, vegetation = self.run_job(
            {"v": 1, "vegetation": True}, self.finished
        )
        output_keys, _, total, _, sharpen = result
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

    def test_an_unmarked_job_is_refused_before_its_download(self):
        with self.assertRaises(worker.JobInputError) as ctx:
            self.run_job(None, self.finished)
        self.assertEqual(safe_error_message(ctx.exception), worker.OLD_JOB)
        self.assertEqual(self.downloads, 0)

    def test_a_pass_left_out_leaves_the_job_complete_without_it(self):
        import json

        def finished(out):
            (out.parent / "sharpen-metrics.json").write_text(
                json.dumps({"wallSeconds": 13.0})
            )
            return self.finished(out)

        result, uploads, _ = self.run_job(
            {"v": 1, "vegetation": True},
            finished,
            {"wallSeconds": 40.0},
            veg_raises=worker.VegetationLeftOut(),
        )
        output_keys, _, total, metrics, sharpen = result
        self.assertEqual(output_keys, [])
        self.assertEqual(total, 30)
        self.assertTrue(sharpen["vegetation"])
        self.assertTrue(sharpen["vegetationLeftOut"])
        self.assertEqual(len(uploads), 3)
        # The pass that was refused or killed is not charged.
        self.assertEqual(metrics["wallSeconds"], 13.0)
        self.assertNotIn("vegetationWallSeconds", metrics)

    def test_another_failure_of_the_pass_still_fails_the_job(self):
        with self.assertRaises(RuntimeError):
            self.run_job(
                {"v": 1, "vegetation": True},
                self.finished,
                veg_raises=RuntimeError("pipeline.py exited with code 1"),
            )


class TestVegetationExit(unittest.TestCase):
    """How `process_vegetation` reads pipeline.py's exit code.

    Mutations that turn it red: the declared exit code dropped from the
    left-out codes, -9 dropped from them, or any other non-zero code treated
    as left out (a real failure would then complete the job).
    """

    def exit_with(self, code):
        import tempfile
        from pathlib import Path
        from unittest import mock

        job = {"id": "job-1", "layer_options": {}}
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.object(worker, "run_with_heartbeat", return_value=code),
        ):
            return worker.process_vegetation(job, tmp, Path(tmp) / "in.zip")

    def test_the_declared_exit_and_a_memory_kill_leave_the_layer_out(self):
        from worker_common import VEGETATION_LEFT_OUT_EXIT

        for code in (VEGETATION_LEFT_OUT_EXIT, -9):
            with self.assertRaises(worker.VegetationLeftOut):
                self.exit_with(code)

    def test_any_other_failure_fails(self):
        for code in (1, 2, -11):
            with self.assertRaises(RuntimeError):
                self.exit_with(code)


class TestLeftOutNotice(unittest.TestCase):
    """The owner is told in the completion notification and the email.

    Mutations that turn it red: the flag not put in the payload (or put there
    when nothing was left out), or the sentence missing from either body.
    """

    def test_the_payload_carries_the_flag_only_when_left_out(self):
        job = {"id": "job-1", "name": "Kanangra"}
        self.assertEqual(
            worker.completion_payload(job, None, True),
            {
                "jobId": "job-1",
                "jobName": "Kanangra",
                "footprint": None,
                "vegetationLeftOut": True,
            },
        )
        self.assertNotIn(
            "vegetationLeftOut", worker.completion_payload(job, None, False)
        )

    def test_the_email_says_it_too(self):
        from unittest import mock

        from worker_common import VEGETATION_LEFT_OUT

        for left_out in (True, False):
            with (
                mock.patch.object(worker, "send_email") as send,
                mock.patch.object(worker, "FRONTEND_URL", "https://logjam.example"),
            ):
                worker.send_completion_email("a@example.com", "job-1", [], left_out)
            _, _, text, html = send.call_args.args
            self.assertEqual(VEGETATION_LEFT_OUT in text, left_out)
            self.assertEqual(VEGETATION_LEFT_OUT in html, left_out)


if __name__ == "__main__":
    unittest.main()
