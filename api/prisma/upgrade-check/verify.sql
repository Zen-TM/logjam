-- Migration UPGRADE check, part 2 of 2: runs after the head's migrations, and
-- compares against what baseline.sql captured. See baseline.sql for why and
-- for when these release-specific metrics are replaced. Fails (exit 3) listing
-- EVERY mismatch, not just the first.

\set ON_ERROR_STOP on

-- Every subject baseline.sql saw is unchanged, and users has neither the
-- cognito_id column nor its index. Mutation: drop the DROP COLUMN (or the DROP
-- INDEX) and the existence check fails; drop the wrong column and a subject
-- goes missing.
SELECT to_regclass('upgrade_check.users') IS NOT NULL AS drop_applies \gset
\if :drop_applies
DO $$
DECLARE bad BIGINT;
BEGIN
  SELECT count(*) INTO bad
    FROM upgrade_check.users b LEFT JOIN users u ON u.id = b.id
   WHERE u.id IS NULL OR u.subject IS DISTINCT FROM b.subject;
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % user(s) lost or changed their subject', bad;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'cognito_id'
  ) OR to_regclass('users_cognito_id_key') IS NOT NULL THEN
    RAISE EXCEPTION 'upgrade-check: users.cognito_id or its index is still there';
  END IF;
END $$;
DROP SCHEMA upgrade_check CASCADE;
\endif
