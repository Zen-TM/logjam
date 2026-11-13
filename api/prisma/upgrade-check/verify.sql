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

-- The four ACA definitions exist with their bounds, scoped to Canyon only, and
-- every definition and scoping row the base had is unchanged. Mutation: change
-- a bound in the migration's first INSERT (aca_water's max 7 to 6).
SELECT to_regclass('upgrade_check_aca.defs') IS NOT NULL AS aca_apply \gset
\if :aca_apply
DO $$
DECLARE bad BIGINT;
BEGIN
  SELECT count(*) INTO bad
    FROM upgrade_check_aca.defs b LEFT JOIN custom_field_defs d ON d.id = b.id
   WHERE d.id IS NULL
      OR (d.owner_id, d.key, d.label, d.type, d.min, d.max, d.position)
         IS DISTINCT FROM (b.owner_id, b.key, b.label, b.type, b.min, b.max, b.position);
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % definition(s) the base had were lost or changed', bad;
  END IF;

  SELECT count(*) INTO bad
    FROM upgrade_check_aca.scopes b
    LEFT JOIN custom_field_def_place_types s
      ON s.def_id = b.def_id AND s.place_type_id = b.place_type_id
   WHERE s.def_id IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % scoping row(s) the base had were lost', bad;
  END IF;

  SELECT count(*) INTO bad FROM (VALUES
      ('aca_technical', 1, 4), ('aca_water', 1, 7),
      ('aca_time', 1, 6), ('aca_risk', 1, 3)
    ) AS want(key, min, max)
    LEFT JOIN custom_field_defs d
      ON d.key = want.key AND d.owner_id IS NULL AND d.type = 'integer'
     AND d.min = want.min AND d.max = want.max
    LEFT JOIN custom_field_def_place_types s
      ON s.def_id = d.id AND s.place_type_id = 'b0000000-0000-4000-8000-000000000001'
   WHERE s.def_id IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % ACA definition(s) missing, wrong or not on Canyon', bad;
  END IF;
END $$;
DROP SCHEMA upgrade_check_aca CASCADE;
\endif
