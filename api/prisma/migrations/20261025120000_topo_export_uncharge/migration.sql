-- An export is no longer charged to storage (it is gone in 7 days, and a charge
-- the owner cannot see or delete is confusing). Give back what the live ones
-- were charged, once: a migration runs once, and the worker and the API stop
-- charging and refunding in the same release. Data only (ADR 0003).
UPDATE users
   SET storage_used_bytes = GREATEST(0, storage_used_bytes - charged.bytes)
  FROM (
    SELECT user_id, SUM(result_bytes) AS bytes
      FROM topo_export_jobs
     WHERE status = 'completed' AND result_bytes IS NOT NULL
     GROUP BY user_id
  ) AS charged
 WHERE users.id = charged.user_id;
