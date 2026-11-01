-- Migration UPGRADE check, part 2 of 2: runs after the head's migrations, and
-- compares against what baseline.sql captured. See baseline.sql for why and
-- for when these release-specific metrics are replaced. Fails (exit 3) listing
-- EVERY mismatch, not just the first.

\set ON_ERROR_STOP on

-- Every user baseline.sql saw has subject = its cognito_id (the NULL and stale
-- fixture rows included), cognito_id is untouched, and subject can no longer be
-- NULL. Mutation: drop the UPDATE and the NULL fixture row blocks SET NOT NULL;
-- filter it to NULL subjects and the stale row keeps the old one; drop the
-- SET NOT NULL and the nullability check fails.
SELECT to_regclass('upgrade_check.users') IS NOT NULL AS subject_applies \gset
\if :subject_applies
DO $$
DECLARE bad BIGINT;
BEGIN
  SELECT count(*) INTO bad
    FROM upgrade_check.users b LEFT JOIN users u ON u.id = b.id
   WHERE u.id IS NULL
      OR u.subject IS DISTINCT FROM b.cognito_id
      OR u.cognito_id IS DISTINCT FROM b.cognito_id;
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % user(s) without subject = their cognito_id', bad;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'subject' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'upgrade-check: users.subject is still nullable';
  END IF;
END $$;
DROP SCHEMA upgrade_check CASCADE;
\endif
