-- Migration UPGRADE check, part 2 of 2: runs after the head's migrations, and
-- compares against what baseline.sql captured. See baseline.sql for why and
-- for when these release-specific metrics are replaced. Fails (exit 3) listing
-- EVERY mismatch, not just the first.

\set ON_ERROR_STOP on

-- Every orphan baseline.sql found is gone and every other notification is
-- still there (with fixtures: a live and two orphan rows of each type, plus an
-- announcement). Mutation: drop either DELETE, or its recipient condition, and
-- a fixture orphan survives; drop its NOT and the live fixture row is deleted.
SELECT to_regclass('upgrade_check.orphan') IS NOT NULL AS orphans_apply \gset
\if :orphans_apply
DO $$
DECLARE bad BIGINT;
BEGIN
  SELECT count(*) INTO bad
    FROM upgrade_check.orphan o JOIN notifications n ON n.id = o.id;
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % orphan share notification(s) left', bad;
  END IF;

  SELECT count(*) INTO bad
    FROM upgrade_check.kept k LEFT JOIN notifications n ON n.id = k.id
   WHERE n.id IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % notification(s) with a live share, or of another type, deleted', bad;
  END IF;
END $$;
DROP SCHEMA upgrade_check CASCADE;
\endif
