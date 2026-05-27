-- Stage 2: on-demand export pipeline + canonical-source storage.
--
-- 1. New TopoExportJob table — one row per user-requested export.
-- 2. App is unreleased; existing TopoJob.s3_output_keys may still reference
--    per-layer raster .mbtiles + composite.mbtiles keys from the Stage 1
--    pipeline. Stage 2 stops producing those at job time; instead the worker
--    now uploads .tif (COG) keys under cogKey. For any in-flight or completed
--    Stage 1 jobs, the user re-runs the job to get a Stage 2 output set. No
--    data migration is needed because the old rows simply won't surface in
--    the new export UI (export route reads cogKey).

CREATE TABLE "topo_export_jobs" (
    "id"                    TEXT NOT NULL,
    "user_id"               TEXT NOT NULL,
    "source_job_ids"        TEXT[] NOT NULL,
    "layers"                TEXT[] NOT NULL,
    "format"                TEXT NOT NULL,
    "bundling"              TEXT NOT NULL,
    "vector_style_snapshot" JSONB NOT NULL,
    "status"                TEXT NOT NULL DEFAULT 'queued',
    "result_key"            TEXT,
    "result_bytes"          BIGINT,
    "error_message"         TEXT,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at"          TIMESTAMP(3),

    CONSTRAINT "topo_export_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "topo_export_jobs_user_id_created_at_idx"
    ON "topo_export_jobs"("user_id", "created_at");

ALTER TABLE "topo_export_jobs"
    ADD CONSTRAINT "topo_export_jobs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
