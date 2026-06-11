"""Status-transition guards in worker.py / export_worker.py (Design L1) and
the single-commit storage charge (ARCH-003 / in-code ARCH-009).

Pure SQL-emission tests on a fake connection: assert the guard predicate is
present, the rowcount is returned, the storage UPDATE shares the commit with
the status UPDATE, and the 0-rows (reaped/deleted) path skips the charge.
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
os.environ.setdefault("JOB_ID", "job-123")
os.environ.setdefault("EXPORT_JOB_ID", "export-123")

try:
    import worker  # noqa: E402
    _WORKER_OK = True
except Exception as _exc:  # noqa: BLE001
    _WORKER_OK = False
    _WORKER_ERR = _exc

try:
    import export_worker  # noqa: E402
    _EXPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _EXPORT_OK = False
    _EXPORT_ERR = _exc


class _FakeCursor:
    def __init__(self, ops, rowcount):
        self._ops = ops
        self._rowcount = rowcount
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self._ops.append(("execute", " ".join(sql.split()), tuple(params or ())))
        # rowcount reflects the most recent execute; the UPDATE under test is
        # always the first one on this cursor.
        self.rowcount = self._rowcount


class _FakeConn:
    """Records every execute and commit in order, so tests can assert what
    shares a transaction with what."""

    def __init__(self, rowcount=1):
        self.ops = []
        self._rowcount = rowcount

    def cursor(self):
        return _FakeCursor(self.ops, self._rowcount)

    def commit(self):
        self.ops.append(("commit",))

    def executes(self):
        return [op for op in self.ops if op[0] == "execute"]

    def ops_before_first_commit(self):
        out = []
        for op in self.ops:
            if op[0] == "commit":
                break
            out.append(op)
        return out


@unittest.skipUnless(_WORKER_OK, f"worker import failed: {globals().get('_WORKER_ERR', '?')}")
class TestWorkerUpdateStatusGuards(unittest.TestCase):
    def test_unguarded_write_has_no_status_predicate(self):
        conn = _FakeConn()
        worker.update_status(conn, "j1", "processing")
        sql = conn.executes()[0][1]
        self.assertIn("WHERE id = %s", sql)
        self.assertNotIn("AND status = %s", sql)

    def test_expected_status_appends_guard_and_param(self):
        conn = _FakeConn()
        worker.update_status(conn, "j1", "complete", expected_status="processing")
        sql, params = conn.executes()[0][1], conn.executes()[0][2]
        self.assertIn("WHERE id = %s AND status = %s", sql)
        self.assertEqual(params[-2:], ("j1", "processing"))

    def test_returns_rowcount(self):
        self.assertEqual(
            worker.update_status(_FakeConn(rowcount=1), "j1", "complete",
                                 expected_status="processing"),
            1,
        )
        self.assertEqual(
            worker.update_status(_FakeConn(rowcount=0), "j1", "complete",
                                 expected_status="processing"),
            0,
        )

    def test_storage_delta_shares_the_single_commit(self):
        conn = _FakeConn(rowcount=1)
        worker.update_status(conn, "j1", "complete",
                             expected_status="processing",
                             storage_delta_bytes=1024)
        before_commit = conn.ops_before_first_commit()
        self.assertEqual(len(before_commit), 2, "status + storage UPDATE before one commit")
        self.assertIn("storage_used_bytes", before_commit[1][1])
        # Exactly one commit overall — no second transaction.
        self.assertEqual(sum(1 for op in conn.ops if op[0] == "commit"), 1)

    def test_zero_rows_skips_storage_delta(self):
        conn = _FakeConn(rowcount=0)
        worker.update_status(conn, "j1", "complete",
                             expected_status="processing",
                             storage_delta_bytes=1024)
        self.assertEqual(len(conn.executes()), 1, "no storage UPDATE for a reaped job")

    def test_zero_delta_skips_storage_update(self):
        conn = _FakeConn(rowcount=1)
        worker.update_status(conn, "j1", "failed", expected_status="processing",
                             error_message="boom")
        self.assertEqual(len(conn.executes()), 1)


@unittest.skipUnless(_EXPORT_OK, f"export_worker import failed: {globals().get('_EXPORT_ERR', '?')}")
class TestExportWorkerUpdateStatusGuards(unittest.TestCase):
    def test_expected_status_appends_guard_and_param(self):
        conn = _FakeConn()
        export_worker.update_status(conn, "e1", "running", expected_status="queued")
        sql, params = conn.executes()[0][1], conn.executes()[0][2]
        self.assertIn("UPDATE topo_export_jobs", sql)
        self.assertIn("WHERE id = %s AND status = %s", sql)
        self.assertEqual(params[-2:], ("e1", "queued"))

    def test_returns_rowcount(self):
        self.assertEqual(
            export_worker.update_status(_FakeConn(rowcount=0), "e1", "completed",
                                        expected_status="running"),
            0,
        )

    def test_completed_charge_shares_the_single_commit(self):
        # ARCH-003 regression: status flip + storage charge must be one commit.
        conn = _FakeConn(rowcount=1)
        export_worker.update_status(conn, "e1", "completed",
                                    expected_status="running",
                                    storage_delta_bytes=2048,
                                    result_key="exports/e1/out.mbtiles",
                                    result_bytes=2048)
        before_commit = conn.ops_before_first_commit()
        self.assertEqual(len(before_commit), 2)
        self.assertIn("storage_used_bytes", before_commit[1][1])
        self.assertEqual(sum(1 for op in conn.ops if op[0] == "commit"), 1)

    def test_zero_rows_skips_storage_charge(self):
        conn = _FakeConn(rowcount=0)
        export_worker.update_status(conn, "e1", "completed",
                                    expected_status="running",
                                    storage_delta_bytes=2048)
        self.assertEqual(len(conn.executes()), 1)

    def test_failed_write_emits_no_storage_update(self):
        conn = _FakeConn(rowcount=1)
        export_worker.update_status(conn, "e1", "failed",
                                    expected_status="running",
                                    error_message="boom")
        self.assertEqual(len(conn.executes()), 1)

    def test_increment_user_storage_helper_is_gone(self):
        # The separate-commit charge path (ARCH-003) must not come back.
        self.assertFalse(hasattr(export_worker, "increment_user_storage"))


if __name__ == "__main__":
    unittest.main()
