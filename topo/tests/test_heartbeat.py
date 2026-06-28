"""worker._heartbeat_loop: status-guarded progress writes + best-effort isolation.

The heartbeat thread polls the pipeline's progress file and refreshes the job's
render-progress columns while it runs. It must (a) write status="processing"
guarded on expected_status="processing", (b) never raise into the job on a DB or
file error, and (c) disable itself cleanly if it can't get a DB connection.
"""
import json
import os
import sys
import tempfile
import threading
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
os.environ.setdefault("JOB_ID", "job-123")

try:
    import worker  # noqa: E402
    _WORKER_OK = True
except Exception as _exc:  # noqa: BLE001
    _WORKER_OK = False
    _WORKER_ERR = _exc


class _FakeConn:
    def __init__(self):
        self.rolled_back = False
        self.closed = False

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


@unittest.skipUnless(_WORKER_OK, f"worker import failed: {globals().get('_WORKER_ERR', '?')}")
class TestHeartbeatLoop(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.progress = Path(self.tmp) / "progress.json"

    def test_writes_status_guarded_progress(self):
        self.progress.write_text(json.dumps({"done": 100, "total": 400, "ts": 1.0}))
        stop = threading.Event()
        calls = []

        def fake_update(conn, job_id, status, expected_status=None, **kwargs):
            calls.append((job_id, status, expected_status, kwargs))
            stop.set()  # exit after the first successful tick
            return 1

        with mock.patch.object(worker, "db_connect", return_value=_FakeConn()), \
                mock.patch.object(worker, "update_status", side_effect=fake_update):
            worker._heartbeat_loop("job-1", self.progress, stop, interval=0.01)

        self.assertEqual(len(calls), 1)
        job_id, status, expected_status, kwargs = calls[0]
        self.assertEqual(job_id, "job-1")
        self.assertEqual(status, "processing")
        self.assertEqual(expected_status, "processing")
        self.assertEqual(kwargs["render_tiles_done"], 100)
        self.assertEqual(kwargs["render_tiles_total"], 400)
        self.assertIn("last_progress_at", kwargs)

    def test_swallows_db_error_without_raising(self):
        self.progress.write_text(json.dumps({"done": 5, "total": 10, "ts": 1.0}))
        stop = threading.Event()
        conn = _FakeConn()

        def boom(*a, **k):
            stop.set()
            raise RuntimeError("db down")

        with mock.patch.object(worker, "db_connect", return_value=conn), \
                mock.patch.object(worker, "update_status", side_effect=boom):
            # Must return normally — never propagate into the job.
            worker._heartbeat_loop("job-1", self.progress, stop, interval=0.01)
        self.assertTrue(conn.rolled_back)

    def test_disabled_when_no_db_connection(self):
        stop = threading.Event()
        update = mock.Mock()
        with mock.patch.object(worker, "db_connect", side_effect=RuntimeError("no db")), \
                mock.patch.object(worker, "update_status", update):
            worker._heartbeat_loop("job-1", self.progress, stop, interval=0.01)
        update.assert_not_called()

    def test_skips_when_progress_unchanged(self):
        self.progress.write_text(json.dumps({"done": 7, "total": 10, "ts": 1.0}))
        stop = threading.Event()
        calls = []
        # Let two ticks elapse, then stop; the second tick must dedup (same done).
        tick = {"n": 0}

        def fake_update(conn, job_id, status, expected_status=None, **kwargs):
            calls.append(kwargs)
            return 1

        def fake_wait(timeout):
            tick["n"] += 1
            return tick["n"] > 2  # False, False, then True → exits after 2 ticks

        with mock.patch.object(worker, "db_connect", return_value=_FakeConn()), \
                mock.patch.object(worker, "update_status", side_effect=fake_update), \
                mock.patch.object(stop, "wait", side_effect=fake_wait):
            worker._heartbeat_loop("job-1", self.progress, stop, interval=0.01)

        # Two ticks, same done → only the first writes.
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
