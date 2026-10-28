-- Migration UPGRADE check, part 2 of 2: runs after the head's migrations, and
-- compares against what baseline.sql captured. See baseline.sql for why and
-- for when these release-specific metrics are replaced. Fails (exit 3) listing
-- EVERY mismatch, not just the first.

\set ON_ERROR_STOP on

-- No GeoPDF job, share or notification is left, nothing else was deleted, and
-- every user's storage is what it was less their completed GeoPDFs, never
-- below 0.
-- Mutation: drop the migration's UPDATE and the fixture user stays at 5000
-- instead of 2500; drop one DELETE and its count below is not 0.
SELECT to_regclass('upgrade_check.geo_pdf_uncharge') IS NOT NULL AS geo_pdf_applies \gset
\if :geo_pdf_applies
DO $$
DECLARE bad BIGINT;
BEGIN
  SELECT count(*) INTO bad
    FROM upgrade_check.geo_pdf_uncharge c JOIN users u ON u.id = c.user_id
   WHERE u.storage_used_bytes IS DISTINCT FROM c.expected;
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % user(s) not uncharged for their GeoPDFs', bad;
  END IF;

  SELECT (SELECT count(*) FROM geo_pdf_jobs)
       + (SELECT count(*) FROM shares WHERE entity_type = 'geoPdfJob')
       + (SELECT count(*) FROM notifications WHERE type = 'geo_pdf_complete')
    INTO bad;
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % GeoPDF row(s) left behind', bad;
  END IF;

  SELECT count(*) INTO bad
    FROM upgrade_check.kept k
   WHERE k.shares IS DISTINCT FROM (SELECT count(*) FROM shares)
      OR k.notifications IS DISTINCT FROM (SELECT count(*) FROM notifications);
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: the migration deleted shares or notifications that are not GeoPDF''s';
  END IF;
END $$;
DROP SCHEMA upgrade_check CASCADE;
\endif
