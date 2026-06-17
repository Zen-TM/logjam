# Topo Pipeline — Logjam

Python + GDAL + PDAL pipeline. Converts NSW ELVIS LiDAR ZIPs to raster MBTiles (hillshade / vegetation / slope / contours / OSM features + composite).

**Authoritative doc:** `topo/README.md`. Read for output format, flags, dep install, perf, troubleshooting. This file = Claude-specific gotchas only.

## Key files

```
topo_mbtiles.py          main entry — CLI + processing pipeline (~77K, monolithic by design)
worker.py                ECS-launched worker wrapper around topo_mbtiles (job-time)
export_worker.py         ECS-launched worker for on-demand TopoExportJob (export-time)
renderers/               per-format export renderers + shared tile compositor
inspect_mbtiles.py       debug tool
build_svtm_formation.py  one-off preprocess: PCT raster → formation raster (Stage 3 of veg rework)
Dockerfile               GDAL + PDAL system deps, Python venv
docker-compose.yml       local run config
requirements.txt         Python deps (GDAL pinned to system version)
SVTM/                    NSW State Vegetation Type Map raw + derived rasters
```

## Gotchas

- **GDAL Python binding must match system GDAL version.** `pip install "GDAL==$(gdal-config --version)"` — no pin in `requirements.txt`.
- **PDAL single-threaded.** Parallelism in tile renderer (`ProcessPoolExecutor`). No multi-process PDAL step.
- **Run inside Docker** unless user asks host run — host GDAL/PDAL installs drift constantly.
- **Worker invoked from API** via ECS RunTask (`api/src/routes/topoJobs.ts`). No worker CLI contract change without API update.
- **Output goes to S3** (bucket `S3_BUCKET_TOPO`, key prefix `outputs/<jobId>/`). Local dev = MiniStack.
- **Two entrypoints, one image.** Dockerfile ENTRYPOINT is `worker.py`. The `logjam-topo-export-worker` task def MUST override the command to `python3 /app/export_worker.py` or it runs the wrong worker. The three worker task defs are now Terraform-managed in `infra/terraform/envs/prod/ecs.tf` (the export def's override lives there as `entryPoint`) — change them via `terraform apply`, not `aws ecs register-task-definition`/console, or Terraform will show drift.
- **Terminal status writes are guarded.** Both workers flip job status with a `WHERE status = 'processing'/'running'` guard so a reaped (force-failed) job can never be resurrected to `complete` by a worker that outlived the reaper's deadline (ARCH-001). Any new status transition must keep this guard — `tests/test_status_guards.py` checks the SQL emission; `tests/test_status_guard_db.py` proves it against a real Postgres (gated on `RUN_DB_IT=1` + real `psycopg2`, skips on host; see `tests/INTEGRATION.md`).
- **Layer list drift is guarded.** `tests/test_layer_sync.py` fails if `worker.py` `ALL_LAYERS`/`RASTER_LAYERS`/`VECTOR_LAYERS` drift from the canonical `shared/src/topoSettings.ts` `TOPO_LAYERS`.
- **Export bytes are quota-accounted, with a 7-day app-side TTL.** `export_worker.py` increments `users.storage_used_bytes` in the same commit as the `completed` status flip; `DELETE /topo-exports/:id` deletes the S3 object and decrements. Completed exports older than `TOPO_EXPORT_TTL_MS` (default 7 days, 0 disables) are swept by the API reaper (`expireCompletedExports` in `api/src/lib/topoJobReaper.ts`): S3 object deleted, quota decremented, row removed in one transaction — **the sweep is authoritative**. The bucket's `expire-exports` lifecycle rule (7-day expiry on `exports/`, verified live 2026-06-11) is backstop-only against orphaned objects; keep its retention in lockstep with `TOPO_EXPORT_TTL_MS`.

## When editing

- Test small ELVIS ZIP first — full runs take minutes to hours (see README perf table).
- `--keep-work` preserves intermediate rasters for inspection.
- No new MBTiles layers without updating the canonical `TOPO_LAYERS` constant (`shared/src/topoSettings.ts` — api/frontend re-export it; `worker.py` `ALL_LAYERS` is the hand-synced Python mirror).

## Conventions log (additive)

- **SVTM is preprocessed once, not per-job.** Raw 2.3 GB PCT raster lives at `topo/SVTM/SVTM_NSW_Extant_PCT_vC2_0_M2_2_5m.tif`. Run `python build_svtm_formation.py` once to produce `topo/SVTM/svtm_formation.tif` (uint8, ~17 classes) + `svtm_formation_legend.json`. Re-run only when the raw SVTM raster is replaced. The topo job pipeline reads the formation raster, never the raw PCT raster. Resistance multipliers (μ) per formation live in `SVTM_FORMATION_MU` in `build_svtm_formation.py`; pipeline reads μ from the legend JSON, not the constant.