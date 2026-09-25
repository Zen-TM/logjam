-- Replace the tile quota with a unified compute-credit allowance, and add the
-- monthly egress meter.
--
-- monthly_tile_quota only ever constrained the topo worker, and counted input
-- tiles rather than cost, so the export and GeoPDF workers had no cost limit at
-- all. Credits (= vCPU-minutes, shared/src/computeCredits.ts) apply to all
-- three.

-- 1200 credits = 20 vCPU-hours ≈ USD $1/month of Fargate.
ALTER TABLE "users" ADD COLUMN "monthly_compute_credits" INTEGER NOT NULL DEFAULT 1200;

-- 50 GiB. The sweeper writes used_bytes; period_start makes the monthly reset
-- lazy (zeroed on first sweep of a new month) rather than a scheduled job.
ALTER TABLE "users" ADD COLUMN "monthly_egress_quota_bytes" BIGINT NOT NULL DEFAULT 53687091200;
ALTER TABLE "users" ADD COLUMN "monthly_egress_used_bytes" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "egress_period_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Carry across a hand-raised allowance rather than silently resetting anyone
-- who was granted extra headroom. The default 40 maps to the new default; a
-- larger grant scales by the same ratio (1200 / 40 = 30 credits per tile,
-- which is also roughly what one ELVIS tile actually costs to process).
UPDATE "users"
SET "monthly_compute_credits" = GREATEST(1200, "monthly_tile_quota" * 30)
WHERE "monthly_tile_quota" IS NOT NULL;

ALTER TABLE "users" DROP COLUMN "monthly_tile_quota";

-- Resume point per S3 access-log prefix. Access-log keys sort by time, so the
-- sweeper resumes with ListObjectsV2 StartAfter and needs no per-object table.
CREATE TABLE "egress_log_cursors" (
    "prefix" TEXT NOT NULL,
    "last_key" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "egress_log_cursors_pkey" PRIMARY KEY ("prefix")
);
