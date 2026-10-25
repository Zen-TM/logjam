-- Migration UPGRADE check, part 2 of 2: runs after the head's migrations, and
-- compares against what baseline.sql captured. See baseline.sql for why and
-- for when these release-specific metrics are replaced. Fails (exit 3) listing
-- EVERY mismatch, not just the first.

\set ON_ERROR_STOP on

SELECT to_regclass('upgrade_check.baseline') IS NOT NULL AS applies \gset
\if :applies

CREATE TEMP TABLE after AS
SELECT * FROM (VALUES
  ('users',             (SELECT count(*) FROM users)),
  ('geo_pdf_templates', (SELECT count(*) FROM geo_pdf_templates))
) AS t(metric, value);

\echo 'upgrade-check after head migrations (base -> after):'
SELECT b.metric, b.value AS base, a.value AS after FROM upgrade_check.baseline b
  LEFT JOIN after a USING (metric) ORDER BY b.metric;

DO $$
DECLARE users_then BIGINT; users_now BIGINT; templates_now BIGINT;
BEGIN
  SELECT value INTO users_then FROM upgrade_check.baseline WHERE metric = 'users';
  SELECT value INTO users_now FROM after WHERE metric = 'users';
  SELECT value INTO templates_now FROM after WHERE metric = 'geo_pdf_templates';
  -- Red if the DELETE is removed from the migration.
  IF templates_now <> 0 THEN
    RAISE EXCEPTION 'upgrade-check: % GeoPDF templates survived the migration', templates_now;
  END IF;
  -- The migration deletes templates and nothing else.
  IF users_now <> users_then THEN
    RAISE EXCEPTION 'upgrade-check: users went % -> %', users_then, users_now;
  END IF;
END $$;
\echo 'upgrade-check: every GeoPDF template deleted, users untouched'

DROP SCHEMA upgrade_check CASCADE;
\echo 'upgrade-check: data carried across'

\else
\echo 'upgrade-check: no baseline captured — release-specific checks skipped.'
\endif

-- Every user's storage is what it was less their live exports, never below 0.
-- Mutation: drop the migration's UPDATE and the fixture user stays at 5000
-- instead of 2500.
SELECT to_regclass('upgrade_check.export_uncharge') IS NOT NULL AS uncharge_applies \gset
\if :uncharge_applies
DO $$
DECLARE bad BIGINT;
BEGIN
  SELECT count(*) INTO bad
    FROM upgrade_check.export_uncharge c JOIN users u ON u.id = c.user_id
   WHERE u.storage_used_bytes IS DISTINCT FROM c.expected;
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % user(s) not uncharged for their exports', bad;
  END IF;
END $$;
\endif
