-- Architecture audit ARCH-001 / ARCH-002 / ARCH-003 / ARCH-005.
--
-- 1. Add indexes on hot foreign-key scalar columns (Postgres does not auto-index
--    FK columns). These gate the share-visibility, notification-list,
--    trip-log-list and topo-job-list read paths on virtually every request.
-- 2. Convert every user-/canyon-owned FK from ON DELETE RESTRICT to ON DELETE
--    CASCADE so the DB owns referential integrity on account/canyon deletion and
--    a missed manual child-delete in route code can no longer strand a delete
--    (the root cause of the broken DELETE /users/me path).
-- 3. Add topo_jobs.started_at + topo_jobs.attempt_count to support the
--    stuck-job reaper (ARCH-002): started_at distinguishes a long-running job
--    from a stale one; attempt_count bounds reaper re-launches.

-- ── New columns on topo_jobs ────────────────────────────────────────────────
ALTER TABLE "topo_jobs" ADD COLUMN "started_at" TIMESTAMP(3);
ALTER TABLE "topo_jobs" ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0;

-- ── Indexes on hot FK columns ───────────────────────────────────────────────
CREATE INDEX "canyons_owner_id_idx" ON "canyons"("owner_id");
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");
CREATE INDEX "trip_logs_canyon_id_idx" ON "trip_logs"("canyon_id");
CREATE INDEX "trip_logs_user_id_idx" ON "trip_logs"("user_id");
CREATE INDEX "media_owner_id_idx" ON "media"("owner_id");
CREATE INDEX "friendships_addressee_id_idx" ON "friendships"("addressee_id");
CREATE INDEX "canyon_shares_canyon_id_idx" ON "canyon_shares"("canyon_id");
CREATE INDEX "canyon_shares_shared_with_id_idx" ON "canyon_shares"("shared_with_id");
CREATE INDEX "canyon_shares_shared_by_id_idx" ON "canyon_shares"("shared_by_id");
CREATE INDEX "topo_jobs_user_id_idx" ON "topo_jobs"("user_id");
CREATE INDEX "topo_jobs_status_idx" ON "topo_jobs"("status");

-- ── Convert RESTRICT → CASCADE on owned relations ───────────────────────────
-- canyons.owner_id
ALTER TABLE "canyons" DROP CONSTRAINT "canyons_owner_id_fkey";
ALTER TABLE "canyons" ADD CONSTRAINT "canyons_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- notifications.user_id
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_fkey";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- trip_logs.canyon_id
ALTER TABLE "trip_logs" DROP CONSTRAINT "trip_logs_canyon_id_fkey";
ALTER TABLE "trip_logs" ADD CONSTRAINT "trip_logs_canyon_id_fkey" FOREIGN KEY ("canyon_id") REFERENCES "canyons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- trip_logs.user_id
ALTER TABLE "trip_logs" DROP CONSTRAINT "trip_logs_user_id_fkey";
ALTER TABLE "trip_logs" ADD CONSTRAINT "trip_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- media.owner_id
ALTER TABLE "media" DROP CONSTRAINT "media_owner_id_fkey";
ALTER TABLE "media" ADD CONSTRAINT "media_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- friendships.requester_id
ALTER TABLE "friendships" DROP CONSTRAINT "friendships_requester_id_fkey";
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- friendships.addressee_id
ALTER TABLE "friendships" DROP CONSTRAINT "friendships_addressee_id_fkey";
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- canyon_shares.canyon_id
ALTER TABLE "canyon_shares" DROP CONSTRAINT "canyon_shares_canyon_id_fkey";
ALTER TABLE "canyon_shares" ADD CONSTRAINT "canyon_shares_canyon_id_fkey" FOREIGN KEY ("canyon_id") REFERENCES "canyons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- canyon_shares.shared_by_id
ALTER TABLE "canyon_shares" DROP CONSTRAINT "canyon_shares_shared_by_id_fkey";
ALTER TABLE "canyon_shares" ADD CONSTRAINT "canyon_shares_shared_by_id_fkey" FOREIGN KEY ("shared_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- canyon_shares.shared_with_id
ALTER TABLE "canyon_shares" DROP CONSTRAINT "canyon_shares_shared_with_id_fkey";
ALTER TABLE "canyon_shares" ADD CONSTRAINT "canyon_shares_shared_with_id_fkey" FOREIGN KEY ("shared_with_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- topo_jobs.user_id
ALTER TABLE "topo_jobs" DROP CONSTRAINT "topo_jobs_user_id_fkey";
ALTER TABLE "topo_jobs" ADD CONSTRAINT "topo_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- topo_export_jobs.user_id
ALTER TABLE "topo_export_jobs" DROP CONSTRAINT "topo_export_jobs_user_id_fkey";
ALTER TABLE "topo_export_jobs" ADD CONSTRAINT "topo_export_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- geo_pdf_templates.user_id
ALTER TABLE "geo_pdf_templates" DROP CONSTRAINT "geo_pdf_templates_user_id_fkey";
ALTER TABLE "geo_pdf_templates" ADD CONSTRAINT "geo_pdf_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- topo_templates.user_id
ALTER TABLE "topo_templates" DROP CONSTRAINT "topo_templates_user_id_fkey";
ALTER TABLE "topo_templates" ADD CONSTRAINT "topo_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
