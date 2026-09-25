# Topo Pipeline — Logjam

Python + GDAL + PDAL pipeline. Converts NSW ELVIS LiDAR ZIPs to raster MBTiles (hillshade / vegetation / slope / contours / OSM features + composite).

**Authoritative doc:** `topo/README.md` (output format, flags, deps, perf, troubleshooting). This file = agent gotchas only.

## Key files

```
pipeline.py              main entry — CLI + processing pipeline (monolithic by design)
worker.py                ECS-launched worker wrapper around pipeline (job-time)
export_worker.py         ECS-launched worker for on-demand TopoExportJob (export-time)
renderers/               per-format export renderers + shared tile compositor
build_svtm_formation.py  one-off preprocess: PCT raster → formation raster
build_fire_history.py    one-off preprocess: NPWS fire history → year raster
Dockerfile               GDAL + PDAL system deps, Python venv
```

## Gotchas

- **Run inside Docker** unless the user asks for a host run — host GDAL/PDAL installs drift. On a host, the GDAL binding must match system GDAL: `pip install "GDAL==$(gdal-config --version)"`.
- **PDAL is single-threaded.** Parallelism lives in the tile renderer (`ProcessPoolExecutor`).
- **The API launches workers** via ECS RunTask (`api/src/routes/topoJobs.ts`); no worker CLI contract change without the API change. Output goes to `S3_BUCKET_TOPO` under `outputs/<jobId>/` (MiniStack locally).
- **Two entrypoints, one image.** ENTRYPOINT is `worker.py`; the export task def overrides it to `export_worker.py`. The worker task defs live in `infra/terraform/envs/prod/ecs.tf` — change them there, never via the console or `register-task-definition`.
- **Terminal status writes are guarded** (`WHERE status = 'processing'/'running'`) so a reaped job can't be resurrected. Any new transition keeps the guard: `tests/test_status_guards.py`, and `tests/test_status_guard_db.py` against real Postgres.
- **A post-`complete` exception never self-cleans; the Dockerfile COPY list is derived from the import graph.** Guards: `TestWorkerPostCompletionSelfClean` in `tests/test_status_guards.py`, `tests/test_docker_image_files.py`. [0067](../docs/decisions/0067-topo-worker-post-complete-never-self-cleans.md)
- **Cross-language mirrors are guarded by `tests/test_layer_sync.py`:** `worker.py` layer lists ↔ `TOPO_LAYERS` (`shared/src/topoSettings.ts`, canonical — a new MBTiles layer starts there), `VECTOR_STYLE_DEFAULTS`, `OSM_STYLE_META` ↔ `OSM_POINT_ICON`, `SVTM_FORMATION_MU` ↔ `SVTM_FORMATIONS`.
- **Export bytes are quota-accounted:** `export_worker.py` increments `users.storage_used_bytes` in the same commit as `completed`; the API reaper's `expireCompletedExports` (`api/src/lib/topoJobReaper.ts`) is the authoritative TTL sweep (`TOPO_EXPORT_TTL_MS`). The bucket's `expire-exports` lifecycle rule is a backstop; keep its retention equal to the TTL.
- **SVTM and fire history are preprocessed once, not per job.** Re-run `build_svtm_formation.py` only when the raw PCT raster changes; the pipeline reads the formation raster and μ from its legend JSON. `build_fire_history.py` builds the fire-year raster the pipeline reads via `FIRE_HISTORY_S3_PATH`; fire history only flags staleness — it **never modifies density**, because the LiDAR already captures regrowth.

## When editing

- Test a small ELVIS ZIP first — full runs take minutes to hours. `--keep-work` keeps intermediate rasters.

## Testing

- `python -m unittest discover -s tests` from `topo/`. Pure-logic tests import `tests/_native_stub.py` first, which stubs `osgeo`/`psycopg2`/etc when absent so they run on a host and in CI; inside the worker image it is a no-op.
- A test exercising a real native lib skips when stubbed (`tests/test_tile_compose.py` for GDAL). `tests/test_status_guard_db.py` needs `RUN_DB_IT=1` + real `psycopg2`; CI runs it against the `api-integration` job's DB (runbook §1).
- Runbook §2 in `tests/INTEGRATION.md` (full worker end-to-end: worker image + a LiDAR fixture) is manual: run it before committing worker changes it covers.
