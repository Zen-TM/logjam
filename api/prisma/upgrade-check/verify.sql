-- Migration UPGRADE check, part 2 of 2: runs after the head's migrations, and
-- compares against what baseline.sql captured. See baseline.sql for why and
-- for when these release-specific metrics are replaced. Fails (exit 3) listing
-- EVERY mismatch, not just the first.

\set ON_ERROR_STOP on

-- Every account the base had holds 800 credits and 10 GiB, an override
-- included, and none was dropped. Mutation: drop the UPDATE from the migration
-- (fixture x keeps 5000 and 100 GiB), or add a WHERE that spares overrides.
SELECT to_regclass('upgrade_check.users') IS NOT NULL AS limits_apply \gset
\if :limits_apply
DO $$
DECLARE bad BIGINT;
BEGIN
  SELECT count(*) INTO bad
    FROM upgrade_check.users b LEFT JOIN users u ON u.id = b.id
   WHERE u.id IS NULL
      OR u.monthly_compute_credits <> 800
      OR u.monthly_egress_quota_bytes <> 10737418240;
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % account(s) did not take the launch limits', bad;
  END IF;
END $$;
DROP SCHEMA upgrade_check CASCADE;
\endif
