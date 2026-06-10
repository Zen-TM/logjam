-- Design L (job lifecycle): persist the ECS task ARN on both job tables so the
-- reaper / DELETE handlers can issue a best-effort StopTask, and give
-- topo_export_jobs a started_at anchor for the running-timeout sweep.
--
-- Correction to 20260604000000_add_fk_indexes_and_cascades: that migration's
-- header says attempt_count "bounds reaper re-launches". No re-launch driver
-- was ever built — the reaper only force-fails stuck jobs. attempt_count
-- records how many times /start launched the job (at most 1 today) and is
-- kept for forensics / a possible future bounded re-launch (ARCH-008).
--
-- The two CreateIndex statements materialise @@index declarations that were
-- already in schema.prisma but missing from the migration history.

-- AlterTable
ALTER TABLE "topo_export_jobs" ADD COLUMN     "ecs_task_arn" TEXT,
ADD COLUMN     "started_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "topo_jobs" ADD COLUMN     "ecs_task_arn" TEXT;

-- CreateIndex
CREATE INDEX "geo_pdf_templates_user_id_idx" ON "geo_pdf_templates"("user_id");

-- CreateIndex
CREATE INDEX "topo_templates_user_id_idx" ON "topo_templates"("user_id");
