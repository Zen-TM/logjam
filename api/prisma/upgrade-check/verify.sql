-- Migration UPGRADE check, part 2 of 2: runs after the head's migrations, and
-- compares against what baseline.sql captured. See baseline.sql for why and
-- for when these release-specific metrics are replaced. Fails (exit 3) listing
-- EVERY mismatch, not just the first.

\set ON_ERROR_STOP on

-- No user changed (subject and cognito_id as baseline.sql saw them), and
-- cognito_id now accepts NULL. Mutation: drop the DROP NOT NULL and the
-- nullability check fails; make the migration touch either value and the
-- comparison fails.
SELECT to_regclass('upgrade_check.users') IS NOT NULL AS nullable_applies \gset
\if :nullable_applies
DO $$
DECLARE bad BIGINT;
BEGIN
  SELECT count(*) INTO bad
    FROM upgrade_check.users b LEFT JOIN users u ON u.id = b.id
   WHERE u.id IS NULL
      OR u.subject IS DISTINCT FROM b.subject
      OR u.cognito_id IS DISTINCT FROM b.cognito_id;
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % user(s) changed', bad;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'cognito_id' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'upgrade-check: users.cognito_id is still NOT NULL';
  END IF;
END $$;
DROP SCHEMA upgrade_check CASCADE;
\endif
