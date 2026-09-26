# Topo pipeline

Python + GDAL + PDAL: NSW ELVIS LiDAR ZIPs to raster MBTiles. `topo/README.md`
covers flags, output format and troubleshooting.

- **Run inside Docker** unless asked for a host run. On a host, the GDAL
  binding must match system GDAL: `pip install "GDAL==$(gdal-config --version)"`.
- **PDAL is single-threaded;** parallelism is in the tile renderer.
- **The API launches the workers** through ECS RunTask (`api/src/routes/topoJobs.ts`),
  so a worker CLI change ships with its API change. One image, two
  entrypoints: `worker.py`, and `export_worker.py` for exports. Their task
  definitions live in `infra/terraform/envs/prod/ecs.tf`; never change them
  in the console.
- **Terminal status writes are guarded** (`WHERE status = 'processing'` or `'running'`) so a
  reaped job cannot be resurrected; a new transition keeps the guard
  (`tests/test_status_guards.py`, `tests/test_status_guard_db.py`).
- **Export bytes are quota-accounted:** `export_worker.py` increments
  `users.storage_used_bytes` in the same commit as `completed`; the API
  reaper's `expireCompletedExports` is the TTL sweep, and the bucket's
  `expire-exports` lifecycle rule keeps the same retention.
- **SVTM and fire history are preprocessed once,** by `build_svtm_formation.py`
  and `build_fire_history.py`; jobs read their outputs, never the raw inputs.
  Fire history only flags cells burnt after the LiDAR capture; it never
  changes density, which the LiDAR already measured.
- **Try a small ELVIS ZIP first:** a full run takes minutes to hours.
  `--keep-work` keeps the intermediate rasters.

## Testing

- `python -m unittest discover -s tests` from `topo/`. A pure-logic test
  imports `tests/_native_stub.py` first, so it runs without GDAL; a test of a
  real native library skips when stubbed. GDAL/PDAL subprocess orchestration
  is not unit-tested: extract the pure part and test that.
- `tests/test_status_guard_db.py` needs `RUN_DB_IT=1` and real `psycopg2`.
- Runbook §2 in `tests/INTEGRATION.md` (worker image end to end) is manual:
  run it before committing a worker change it covers.
