-- Drops the geo_pdf_jobs table and its Prisma model, the contract step of
-- 20261027000000_delete_geo_pdf_jobs (ADR 0043, ADR 0003): the image that read
-- the table is gone from the swap.
-- The refund and the DELETEs repeat because the previous image could still
-- queue a job after the first migration ran, and complete it: that job was
-- charged to storage and still has its share and notification.
UPDATE users
   SET storage_used_bytes = GREATEST(0, storage_used_bytes - charged.bytes)
  FROM (
    SELECT user_id, SUM(result_bytes) AS bytes
      FROM geo_pdf_jobs
     WHERE status = 'completed' AND result_bytes IS NOT NULL
     GROUP BY user_id
  ) AS charged
 WHERE users.id = charged.user_id;

DELETE FROM "shares" WHERE "entity_type" = 'geoPdfJob';
DELETE FROM "notifications" WHERE "type" = 'geo_pdf_complete';
DELETE FROM "geo_pdf_jobs";

DROP TABLE "geo_pdf_jobs";
