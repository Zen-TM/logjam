-- Async GeoPDF generation (mirrors topo_export_jobs). Submitted via POST
-- /geo-pdf, rendered by ECS task `logjam-geo-pdf-worker`
-- (api/src/worker/geoPdfWorker.ts), uploaded to
-- s3://BUCKET/exports/geo-pdf/{id}/logjam-export.pdf.

CREATE TABLE "geo_pdf_jobs" (
    "id"                    TEXT NOT NULL,
    "user_id"               TEXT NOT NULL,
    "config"                JSONB NOT NULL,
    "vector_style_snapshot" JSONB NOT NULL,
    "status"                TEXT NOT NULL DEFAULT 'queued',
    "result_key"            TEXT,
    "result_bytes"          BIGINT,
    "error_message"         TEXT,
    "started_at"            TIMESTAMP(3),
    "ecs_task_arn"          TEXT,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at"          TIMESTAMP(3),

    CONSTRAINT "geo_pdf_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "geo_pdf_jobs_user_id_created_at_idx"
    ON "geo_pdf_jobs"("user_id", "created_at");

ALTER TABLE "geo_pdf_jobs"
    ADD CONSTRAINT "geo_pdf_jobs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
