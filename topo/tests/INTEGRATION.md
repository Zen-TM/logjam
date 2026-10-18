# Topo worker integration tests

The host-side unit tests stub the native stack (`_native_stub.py`), so the seam
between the guarded status logic and a **real** runtime is not exercised by
`python -m unittest discover -s tests` on the dev host. Two integration
layers close that gap. §1 is opt-in and skips in normal host discovery; §2, the
full worker run, is CI's `topo-e2e` job, which can also be run by hand.

## 1. Status-guard against a real Postgres — `test_status_guard_db.py`

Proves a live database enforces the `WHERE status = ...` guard, so a
reaped-but-alive worker cannot resurrect a force-failed job or charge
storage for it. Needs a real `psycopg2` (the host stubs it) and a
reachable DB; gated on `RUN_DB_IT=1`. **CI runs it** in the `api-integration` job, against that job's seeded DB.

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

## 2. Full worker end-to-end — CI's `topo-e2e` job

Runs the worker image on a real LiDAR input through the real GDAL/PDAL
pipeline. **CI runs it** (`topo-e2e` in `.github/workflows/ci.yml`) on one ELVIS
LAZ tile as ELVIS ships it, fetched by `scripts/sample-data.sh
elvis-katoomba-2506258-laz.zip`:

1. Builds the image (layer-cached) and brings up Postgres, MiniStack S3 and the
   seeded API.
2. Creates two jobs as Logjam Web does: `POST /topo-jobs`, a PUT to the
   presigned URL, `POST /topo-jobs/:id/start`. With no `ECS_SUBNETS` the API
   leaves them `pending` instead of calling RunTask.
3. Runs the container as the ECS task would, with the task definition's env
   (`e2e/worker.env`), on a Docker network with no internet: Overpass is a stub
   serving `e2e/overpass-katoomba-2506258.json`, and the SVTM and fire-history
   rasters are made-up ones in MiniStack, read through `/vsis3/`.
4. **Happy path** (`e2e/check.py complete`): the row is `complete` with its
   outputs, footprint, metrics and storage charge; the objects are in the
   bucket and the input ZIP is gone; every layer's tile on Mount Solitary
   decodes and is not blank.
5. **Resurrection check** (`e2e/check.py reaped`): the second job's worker is
   killed mid-render and the row force-failed as the reaper would; a worker
   relaunched for the same `JOB_ID` leaves it `failed`, with no outputs and no
   notification.

What stays manual: a multi-tile or multi-survey ZIP, a real SVTM or fire
raster, live Overpass, and a run on Fargate itself. Run one by hand (below)
before committing a worker change that touches those.

### By hand, against the dev stack

`make dev` builds and launches the worker itself: starting a LiDAR map in
Logjam Web makes MiniStack's ECS run the image `logjam-topo-worker:latest`
(`infra/terraform/envs/local/ecs.tf`). After a worker change, rebuild it with
`make build-workers`. To rerun a worker by hand on the dev stack's network
(`logjam-local`, where `postgres` and `ministack` resolve), give it the task
definition's env from `worker_common_env` in that `ecs.tf` and the S3 settings
from the GDAL block of `e2e/worker.env`:

    docker run --rm --network logjam-local --env-file topo/tests/e2e/worker.env \
      -e JOB_ID=<id> -e OVERPASS_ENDPOINTS=https://overpass-api.de/api/interpreter \
      -e SVTM_FORMATION_S3_PATH= -e FIRE_HISTORY_S3_PATH= logjam-topo-worker:latest

(`worker.env` points Overpass and the rasters at CI's stubs; the `-e` overrides
send them to the real mirror and skip the rasters.) It claims only a `pending` job.

The automated DB test (#1) covers the guard semantics; this job covers the
real-pipeline control flow around it.
