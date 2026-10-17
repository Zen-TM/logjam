# Topo pipeline

Python + GDAL + PDAL: NSW ELVIS LiDAR ZIPs to raster MBTiles. `topo/README.md`
covers flags, output format and troubleshooting.

- **Run inside Docker** unless asked for a host run: host GDAL/PDAL installs
  drift. On a host, the GDAL binding must match system GDAL:
  `pip install "GDAL==$(gdal-config --version)"`.
- **Try a small ELVIS ZIP first:** a full run takes minutes to hours.
  `--keep-work` keeps the intermediate rasters.
- **The API launches the workers** through ECS RunTask (`api/src/routes/topoJobs.ts`),
  so a worker CLI or output change ships with its API change. Task
  definitions live in `infra/terraform/envs/prod/ecs.tf`.
- **A terminal status write is guarded by the status it expects**
  (`WHERE status = 'processing'` or `'running'`), so a reaped job cannot be
  resurrected; a new transition keeps the guard (`tests/test_status_guards.py`).

## Testing

- `python -m unittest discover -s tests` from `topo/`. A pure-logic test
  imports `tests/_native_stub.py` first, so it runs without GDAL; a test of a
  real native library skips when stubbed. GDAL/PDAL subprocess orchestration
  is not unit-tested: extract the pure part and test that.
- `tests/test_status_guard_db.py` needs `RUN_DB_IT=1` and real `psycopg2`.
- CI's `topo-e2e` job runs the worker image end to end on one real ELVIS tile
  (`tests/INTEGRATION.md` §2). Its network has no internet, so a network or
  S3 read added to the worker needs a stub in `tests/e2e/` too.
