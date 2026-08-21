"""ARCH-001 resurrection invariant against a REAL Postgres (gap 3).

test_status_guards.py proves the guard at the SQL-emission level on a fake
cursor. This test closes the remaining seam — that a real database actually
enforces the `WHERE status = ...` guard so a reaped-but-alive worker cannot
resurrect a force-failed job — by running worker.update_status against a live
Postgres.

Like test_tile_compose.py's real-GDAL gate, this skips on the dev host: the host
has no psycopg2 (it's stubbed), so the test only runs where a real driver and a
reachable DB exist — inside the worker Docker image, or any env that sets
RUN_DB_IT=1 with the seeded local stack up (`make dev`). It uses the seeded
alice user and inserts/cleans up its own topo_jobs row, leaving the seed intact.

Run it from the worker image (psycopg2 present) against the dev DB:
    RUN_DB_IT=1 DB_HOST=postgres DB_NAME=logjam DB_USER=... DB_PASSWORD=... \
        JOB_ID=unused python3 -m unittest tests.test_status_guard_db
"""
import os
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: E402

# Only run with a REAL psycopg2 (not the host stub) and an explicit opt-in.
_RUN_DB_IT = (
    os.environ.get("RUN_DB_IT") == "1"
    and not _native_stub.is_stubbed("psycopg2")
)

# worker.py requires these at import time.
os.environ.setdefault("S3_BUCKET_TOPO", "test-bucket")
os.environ.setdefault("JOB_ID", "unused-for-this-test")

# Seeded dev user (api/prisma/seed.ts).
ALICE_ID = "00000000-0000-4000-8000-000000000001"


@unittest.skipUnless(
    _RUN_DB_IT, "real psycopg2 + RUN_DB_IT=1 + reachable DB required"
)
class TestStatusGuardAgainstRealDb(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import worker  # noqa: E402

        cls.worker = worker
        cls.conn = worker.db_connect()

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def setUp(self):
        self.job_id = str(uuid.uuid4())
        with self.conn.cursor() as cur:
            # updated_at is Prisma @updatedAt (no DB default) — set it explicitly
            # since this insert bypasses the Prisma client.
            cur.execute(
                "INSERT INTO topo_jobs (id, user_id, status, updated_at)"
                " VALUES (%s, %s, %s, NOW())",
                (self.job_id, ALICE_ID, "processing"),
            )
        self.conn.commit()

    def tearDown(self):
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM topo_jobs WHERE id = %s", (self.job_id,))
        self.conn.commit()

    def _status(self):
        with self.conn.cursor() as cur:
            cur.execute("SELECT status FROM topo_jobs WHERE id = %s", (self.job_id,))
            return cur.fetchone()["status"]

    def _alice_storage(self):
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT storage_used_bytes FROM users WHERE id = %s", (ALICE_ID,)
            )
            return cur.fetchone()["storage_used_bytes"]

    def test_guarded_write_does_not_resurrect_a_reaped_job(self):
        # Reaper force-fails the job out from under the worker.
        self.worker.update_status(self.conn, self.job_id, "failed")
        self.assertEqual(self._status(), "failed")

        # The worker, still alive, tries to mark it complete with the guard.
        updated = self.worker.update_status(
            self.conn, self.job_id, "complete", expected_status="processing"
        )
        self.assertEqual(updated, 0)  # guard matched no rows
        self.assertEqual(self._status(), "failed")  # NOT resurrected

    def test_unguarded_write_does_update(self):
        # Control: without the guard the same write would land.
        updated = self.worker.update_status(self.conn, self.job_id, "complete")
        self.assertEqual(updated, 1)
        self.assertEqual(self._status(), "complete")

    def test_storage_delta_skipped_when_guard_matches_zero_rows(self):
        self.worker.update_status(self.conn, self.job_id, "failed")
        before = self._alice_storage()
        updated = self.worker.update_status(
            self.conn,
            self.job_id,
            "complete",
            storage_delta_bytes=4096,
            expected_status="processing",
        )
        self.assertEqual(updated, 0)
        # No quota charge for a job the guard refused to complete (ARCH-007).
        self.assertEqual(self._alice_storage(), before)


if __name__ == "__main__":
    unittest.main()
