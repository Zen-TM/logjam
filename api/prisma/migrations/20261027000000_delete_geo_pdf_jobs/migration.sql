-- GeoPDFs are rendered in the browser now (ADR 0043); the server job path,
-- its history and its sharing are removed, so this deletes the rows that
-- exist at deploy and gives back what the completed ones were charged to
-- storage, once: a migration runs once, and the API stops charging and
-- refunding in the same release. The previous image can still queue one until
-- it is replaced; that straggler goes with the table, which drops a release
-- later along with its Prisma model (ADR 0003).
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
