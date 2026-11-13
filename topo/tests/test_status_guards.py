"""Status-transition guards in worker.py / export_worker.py and
(worker.py's single-commit storage charge; an export is never charged).

Pure SQL-emission tests on a fake connection: assert the guard predicate is
present, the rowcount is returned, the storage UPDATE shares the commit with
the status UPDATE, and the 0-rows (reaped/deleted) path skips the charge.
"""

import ast
import os
import sys
import unittest
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
os.environ.setdefault("EXPORT_JOB_ID", "export-123")

# No try/except and no skipUnless: the stub makes these imports safe, so a
# failure here is a real break (an unstubbed native import) and must be an
# error, not a skip that leaves every status guard unrun with CI green.
# Mutation that turns it red: `import notarealnativemodule` at the top of
# worker.py or export_worker.py.
import export_worker  # noqa: E402
import worker  # noqa: E402


def _status_writes(module):
    """(status, expected_status) of every `update_status(...)` call in a
    worker, read from the source: the helper's tests below cannot see a call
    site that forgot the guard."""
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), module)
    with open(path) as f:
        tree = ast.parse(f.read())
    writes = []
    for node in ast.walk(tree):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "update_status"
        ):
            continue
        status = ast.literal_eval(node.args[2])
        expected = next(
            (
                ast.literal_eval(k.value)
                for k in node.keywords
                if k.arg == "expected_status"
            ),
            None,
        )
        writes.append((status, expected))
    return sorted(writes, key=str)


class TestEveryStatusWriteIsGuarded(unittest.TestCase):
    """Mutation that turns it red: delete `expected_status="processing",` from
    the `complete` or `failed` write in worker.py (or `"running"` from
    export_worker.py), or add a transition that is not in the table here."""

    def test_worker_writes(self):
        self.assertEqual(
            _status_writes("worker.py"),
            sorted(
                [
                    ("processing", "pending"),
                    ("processing", "processing"),
                    ("complete", "processing"),
                    ("failed", "processing"),
                ],
                key=str,
            ),
            "every update_status call in worker.py names the status it expects "
            "(a reaped job must not be resurrected). Add expected_status=..., "
            "and list a new transition in this table.",
        )

    def test_export_worker_writes(self):
        self.assertEqual(
            _status_writes("export_worker.py"),
            sorted(
                [
                    ("running", "queued"),
                    ("failed", "running"),
                    ("completed", "running"),
                ],
                key=str,
            ),
            "every update_status call in export_worker.py names the status it "
            "expects (a reaped job must not be resurrected). Add "
            "expected_status=..., and list a new transition in this table.",
        )


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
            worker.update_status(
                _FakeConn(rowcount=1), "j1", "complete", expected_status="processing"
            ),
            1,
        )
        self.assertEqual(
            worker.update_status(
                _FakeConn(rowcount=0), "j1", "complete", expected_status="processing"
            ),
            0,
        )

    def test_storage_delta_shares_the_single_commit(self):
        conn = _FakeConn(rowcount=1)
        worker.update_status(
            conn,
            "j1",
            "complete",
            expected_status="processing",
            storage_delta_bytes=1024,
        )
        before_commit = conn.ops_before_first_commit()
        self.assertEqual(
            len(before_commit), 2, "status + storage UPDATE before one commit"
        )
        self.assertIn("storage_used_bytes", before_commit[1][1])
        # Exactly one commit overall — no second transaction.
        self.assertEqual(sum(1 for op in conn.ops if op[0] == "commit"), 1)

    def test_zero_rows_skips_storage_delta(self):
        conn = _FakeConn(rowcount=0)
        worker.update_status(
            conn,
            "j1",
            "complete",
            expected_status="processing",
            storage_delta_bytes=1024,
        )
        self.assertEqual(len(conn.executes()), 1, "no storage UPDATE for a reaped job")

    def test_zero_delta_skips_storage_update(self):
        conn = _FakeConn(rowcount=1)
        worker.update_status(
            conn, "j1", "failed", expected_status="processing", error_message="boom"
        )
        self.assertEqual(len(conn.executes()), 1)


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
            export_worker.update_status(
                _FakeConn(rowcount=0), "e1", "completed", expected_status="running"
            ),
            0,
        )

    def test_completed_export_never_charges_storage(self):
        # An export is not charged to storage; a charge would be one the owner
        # can neither see nor delete.
        conn = _FakeConn(rowcount=1)
        export_worker.update_status(
            conn,
            "e1",
            "completed",
            expected_status="running",
            result_key="exports/e1/out.mbtiles",
            result_bytes=2048,
        )
        self.assertEqual(len(conn.executes()), 1)
        self.assertNotIn("users", conn.executes()[0][1])
        self.assertEqual(sum(1 for op in conn.ops if op[0] == "commit"), 1)
        # Mutation: a charge written anywhere in the worker turns this red.
        import inspect

        self.assertNotIn("storage_used_bytes", inspect.getsource(export_worker))

    def test_failed_write_emits_no_storage_update(self):
        conn = _FakeConn(rowcount=1)
        export_worker.update_status(
            conn, "e1", "failed", expected_status="running", error_message="boom"
        )
        self.assertEqual(len(conn.executes()), 1)

    def test_increment_user_storage_helper_is_gone(self):
        # The separate-commit charge path must not come back.
        self.assertFalse(hasattr(export_worker, "increment_user_storage"))


class TestWorkerPostCompletionSelfClean(unittest.TestCase):
    """A raise AFTER the `complete` flip must never delete outputs.

    The guarded `failed` write matches 0 rows once the row is `complete`, and
    the 0-rowcount branch means "reaped or deleted" — self-clean S3. That is
    only true before the flip. Post-flip (e.g. push notification failure, a
    create_notification blip) outputs must not be deleted while the row says
    complete.
    """

    def _run_main(self, *, fail_in_process_job=False, fail_after_complete=False):
        self.s3 = mock.MagicMock()
        deleted = []
        statuses = []

        class _Conn:
            def close(self):
                pass

        def _update_status(conn, job_id, status, **kwargs):
            statuses.append(status)
            # claim + complete succeed; the guarded `failed` write matches 0
            # rows (row is `complete` or the reaper already failed it).
            return 0 if status == "failed" else 1

        def _process_job(job, tmp):
            if fail_in_process_job:
                raise RuntimeError("pipeline blew up")
            return ([], None, 0, None, {})

        def _create_notification(conn, user_id, kind, payload):
            if fail_after_complete and kind == "topo_complete":
                raise RuntimeError("transient DB blip")

        with (
            mock.patch.multiple(
                worker,
                db_connect=lambda: _Conn(),
                get_job=lambda conn, job_id: {
                    "id": job_id,
                    "user_id": "u1",
                    "name": "n",
                    "s3_input_key": "in.zip",
                },
                update_status=_update_status,
                process_job=_process_job,
                create_notification=_create_notification,
                get_user_email=lambda conn, uid: None,
                delete_s3_prefix_best_effort=lambda prefix: deleted.append(prefix),
                s3=self.s3,
            ),
            mock.patch.dict(sys.modules, {"push_send": mock.MagicMock()}),
        ):
            try:
                worker.main()
            except SystemExit as exit_exc:
                self.assertEqual(exit_exc.code, 1)
        return deleted, statuses

    def test_post_complete_failure_does_not_delete_outputs(self):
        deleted, statuses = self._run_main(fail_after_complete=True)
        self.assertEqual(deleted, [], "outputs of a COMPLETE job were deleted")
        self.assertIn("complete", statuses)
        self.assertNotIn(
            "failed", statuses, "a completed job must not be re-flipped to failed"
        )

    def test_pre_complete_failure_still_self_cleans(self):
        # A failure before the flip whose guarded `failed` write matches 0 rows
        # still cleans up.
        deleted, statuses = self._run_main(fail_in_process_job=True)
        self.assertNotIn("complete", statuses)
        self.assertIn("failed", statuses)
        self.assertEqual(deleted, ["outputs/job-123/"])

    def test_failed_job_deletes_its_input_zip(self):
        # No server path reuses the upload (retry = a new job), so a failed job
        # must not leave a multi-GB ZIP behind. Mutation: drop the delete in
        # the except path of main().
        self._run_main(fail_in_process_job=True)
        self.s3.delete_object.assert_called_once_with(
            Bucket="test-bucket", Key="in.zip"
        )

    def test_input_zip_delete_failure_does_not_change_the_outcome(self):
        with mock.patch.object(worker, "s3") as s3:
            s3.delete_object.side_effect = RuntimeError("s3 down")
            worker.delete_input_zip_best_effort("in.zip")  # must not raise


if __name__ == "__main__":
    unittest.main()
