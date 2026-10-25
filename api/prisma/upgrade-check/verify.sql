-- Migration UPGRADE check, part 2 of 2: runs after the head's migrations, and
-- compares against what baseline.sql captured. See baseline.sql for why and
-- for when these release-specific metrics are replaced. Fails (exit 3) listing
-- EVERY mismatch, not just the first.

\set ON_ERROR_STOP on

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
DROP SCHEMA upgrade_check CASCADE;
\endif
