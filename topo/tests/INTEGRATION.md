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
pipeline, launched through the API's real ECS RunTask path. **CI runs it**
(`topo-e2e` in `.github/workflows/ci.yml`) on one ELVIS
LAZ tile as ELVIS ships it, fetched by `scripts/sample-data.sh
elvis-katoomba-2506258-laz.zip`:

1. Builds the image (layer-cached) and brings up Postgres, MiniStack (S3 and
   ECS, with the Docker socket) and the seeded API, which has `ECS_SUBNETS`
   set.
2. Puts the worker on a Docker network with no internet: the SVTM and
   fire-history rasters are made-up ones in MiniStack, read through
   `/vsis3/`. It registers a task definition in MiniStack whose env is
   `e2e/worker.env` (itself checked against prod's `ecs.tf`) and whose
   container name is prod's.
3. Creates a job as Logjam Web does (`e2e/start-job.sh`): `POST /topo-jobs`, a
   PUT to the presigned URL, `POST /topo-jobs/:id/start`. `/start` calls
   RunTask, so MiniStack runs the worker. `e2e/ecs-worker.sh` checks that the
   row has its `ecs_task_arn`, that MiniStack lists that task, and that the
   container got the `JOB_ID` override and sits on the no-internet network
   only.
4. **Sharpen** (`e2e/check.py sharpened`): before the job starts,
   `e2e/statewide.py` puts made-up stand-ins for the statewide height and
   slope archives in MiniStack (the heights a steep plane, so the check can
   say what every fill pixel must hold). `SHARPEN_NEW_JOBS`
   (`shared/src/sharpen.ts`) is on, so `/start` marks the job and the worker
   runs `sharpen.py`. The row must be `complete` with its result and ground
   kind, every z15 tile of its range in both raster archives, the survey's own
   heights on Mount Solitary, the fill pixels of the range's corner tile in
   place, and a contour tile.
5. **Vegetation** (`e2e/check.py ticked`): a second job is started the same
   way with the vegetation tick, so the worker also runs `pipeline.py`'s
   vegetation pass. The worker exits 0 and reads the SVTM raster; the row is
   `complete`, keeps the tick, holds one vegetation output and the fire
   raster's staleness in its metrics, and charges storage; the input ZIP is
   gone, and the vegetation tile on Mount Solitary is not blank.
6. **Resurrection check** (`e2e/check.py reaped`): a ticked job is inserted
   by hand (`e2e/ticked-job.sh`, so no RunTask launches a worker for it), its
   worker killed as soon as it has claimed the row (the one-tile job is done
   in under a minute, too soon for its heartbeat) and the row force-failed as
   the reaper would; a
   worker relaunched for the same `JOB_ID` leaves it `failed`, writes no
   outputs and sends no notification. Both workers are started by
   `docker run` with `e2e/worker.env`, not RunTask: only the reaper's half is
   stood in for.

MiniStack runs a task on the first network of its own container, by name, so
the job's no-internet network is named to sort before the job's own.

What stays manual: a multi-tile or multi-survey ZIP, a real SVTM or fire
raster, and a run on Fargate itself. Run one by hand (below)
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
      -e JOB_ID=<id> -e SVTM_FORMATION_S3_PATH= -e FIRE_HISTORY_S3_PATH= \
      logjam-topo-worker:latest

(`worker.env` points the rasters at CI's stand-ins; the `-e` overrides skip
them.) It claims only a `pending` job.

A job started in Logjam Web sharpens (`SHARPEN_NEW_JOBS`), and `sharpen.py`
reads the statewide height and slope archives from the dev bucket, which
nothing local puts there. Before starting one, put CI's made-up stand-ins in
(a steep plane, so the area's fill looks nothing like real ground):

    mkdir -p /tmp/statewide
    docker run --rm -v /tmp/statewide:/out -v "$PWD/topo/tests/e2e:/e2e:ro" \
      --entrypoint python3 logjam-topo-worker:latest /e2e/statewide.py /out
    for name in nsw-5m nsw-5m-slope; do
      AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=ap-southeast-2 \
        aws --endpoint-url http://localhost:4566 s3 cp /tmp/statewide/$name.pmtiles \
        s3://logjam-topo-local/master/dem/$name.pmtiles
    done

The height stand-in replaces the Katoomba slice the root README's Local
Development section uploads to the same key for dev maps (`DEV_MASTER_URL`),
so dev maps then draw the plane. Re-run that section's `curl` afterwards to
get the real slice back. It uploads no slope, so remove the slope stand-in (a
flat 3° plane, which bands covering 3° would tint):

    AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=ap-southeast-2 \
      aws --endpoint-url http://localhost:4566 s3 rm \
      s3://logjam-topo-local/master/dem/nsw-5m-slope.pmtiles

The automated DB test (#1) covers the guard semantics; this job covers the
real-pipeline control flow around it.
