# Topo worker integration tests (gap 3)

The host-side unit tests stub the native stack (`_native_stub.py`), so the seam
between the guarded status logic and a **real** runtime is not exercised by
`python -m unittest discover -s tests` on the dev host. Two opt-in integration
layers close that gap. Both skip by default and never run in normal host
discovery.

## 1. Status-guard against a real Postgres — `test_status_guard_db.py`

Proves a live database enforces the `WHERE status = ...` guard, so a
reaped-but-alive worker cannot resurrect a force-failed job (ARCH-001) or charge
storage for it (ARCH-007). Needs a real `psycopg2` (the host stubs it) and a
reachable DB; gated on `RUN_DB_IT=1`.

**Lightest local run (no image build)** — against the `make dev` Postgres:

```bash
# from repo root, with `make dev` up (Postgres on localhost:5432, seeded)
pip install psycopg2-binary           # host has no psycopg2 otherwise
cd topo
RUN_DB_IT=1 \
  DB_HOST=localhost DB_PORT=5432 DB_NAME=logjam \
  DB_USER=<dev_user> DB_PASSWORD=<dev_pw> \
  JOB_ID=unused \
  python3 -m unittest tests.test_status_guard_db -v
```

(DB_* values come from the root `.env.local` rendered by `make dev`.) Inside the
worker image psycopg2 is already present, so only `RUN_DB_IT=1` + the DB env are
needed.

## 2. Full worker end-to-end (real GDAL/PDAL kill + relaunch)

Exercises `worker.py` against a real LiDAR input through the real GDAL/PDAL
pipeline, then verifies the reaper/worker interplay under a mid-render kill.
This requires the worker Docker image and a small LiDAR fixture, so it is an
**operator runbook**, not an automated host test (no LiDAR fixture is committed —
real LAZ tiles are large, and the image build pulls UbuntuGIS + builds tippecanoe
from source).

Steps:

1. Build the image: `docker compose build` (in `topo/`).
2. Bring up the dev stack (`make dev`) so Postgres + LocalStack S3 are reachable
   from the container, and put a small ELVIS ZIP at `topo/input/elvis.zip`
   (smallest available tile — see `README.md` perf table).
3. Seed a `topo_jobs` row in `status='processing'` for the seeded alice user with
   `s3_input_key` pointing at the uploaded ZIP, and run the worker container with
   `JOB_ID=<that id>` and the DB/S3 env pointing at the dev stack.
4. **Happy path:** let it finish; assert the row reaches `complete`, output keys
   are populated, and tiles land in the `S3_BUCKET_TOPO` bucket.
5. **Resurrection check (ARCH-001):** start a fresh job, `docker kill` the
   container mid-render, then force-fail the row (`UPDATE topo_jobs SET
   status='failed'`) as the reaper would. Re-launch a worker for the **same**
   `JOB_ID`; confirm its guarded terminal write leaves the row `failed` (the
   `test_status_guard_db.py` invariant, now end-to-end through real processing).

The automated DB test (#1) covers the guard semantics; this runbook covers the
real-pipeline control flow around it.
