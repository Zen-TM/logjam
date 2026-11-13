-- Migration UPGRADE check, part 2 of 2: runs after the head's migrations, and
-- compares against what baseline.sql captured. See baseline.sql for why and
-- for when these release-specific metrics are replaced. Fails (exit 3) listing
-- EVERY mismatch, not just the first.

\set ON_ERROR_STOP on

-- The four ACA definitions exist with their bounds and exactly four scoping rows,
-- all on Canyon; every other definition and scoping row the base had is
-- unchanged; and an account's own definition that held one of the four keys is
-- renamed with its values, never dropped. Mutations, each seen red: change a bound
-- in the migration's first INSERT (aca_water's max 7 to 6); skip the
-- `field_values` move in the rename; choose the suffix without looking at what the
-- owner holds (the fixtures' aca_risk meets the aca_risk_2 they hold, and the
-- migration itself fails).
SELECT to_regclass('upgrade_check_aca.defs') IS NOT NULL AS aca_apply \gset
\if :aca_apply
DO $$
DECLARE bad BIGINT;
BEGIN
  -- A definition keeps its row and every column. Only the key of an account's own
  -- definition that held one of the four may change, to `<key>_<n>`.
  SELECT count(*) INTO bad
    FROM upgrade_check_aca.defs b LEFT JOIN custom_field_defs d ON d.id = b.id
   WHERE d.id IS NULL
      OR (d.owner_id, d.label, d.type, d.min, d.max, d.position)
         IS DISTINCT FROM (b.owner_id, b.label, b.type, b.min, b.max, b.position)
      OR CASE
           WHEN b.owner_id IS NOT NULL
            AND b.key IN ('aca_technical', 'aca_water', 'aca_time', 'aca_risk')
           THEN d.key !~ ('^' || b.key || '_[0-9]+$')
           ELSE d.key <> b.key
         END;
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
      ('aca_time', 1, 6), ('aca_risk', 1, 5)
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

  -- Canyon only: the four ids carry exactly four scoping rows between them.
  SELECT count(*) INTO bad FROM custom_field_def_place_types
   WHERE def_id IN ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000012',
                    'a0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000014');
  IF bad <> 4 THEN
    RAISE EXCEPTION 'upgrade-check: the ACA definitions have % scoping rows, expected 4', bad;
  END IF;

  -- No account's own definition keeps a system key.
  SELECT count(*) INTO bad FROM custom_field_defs
   WHERE entity = 'place' AND owner_id IS NOT NULL
     AND key IN ('aca_technical', 'aca_water', 'aca_time', 'aca_risk');
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % account definition(s) still hold an ACA key', bad;
  END IF;
END $$;
SELECT to_regclass('upgrade_check_aca.fixtures') IS NOT NULL AS aca_fixtures \gset
\if :aca_fixtures
DO $$
DECLARE bad BIGINT;
BEGIN
  -- aca_water became aca_water_2; aca_risk skipped the aca_risk_2 the owner holds.
  SELECT count(*) INTO bad FROM (VALUES
      ('upgrade-fixture-aca-water', 'aca_water_2'),
      ('upgrade-fixture-aca-risk', 'aca_risk_3'),
      ('upgrade-fixture-aca-risk-2', 'aca_risk_2')
    ) AS want(id, key)
    LEFT JOIN custom_field_defs d ON d.id = want.id AND d.key = want.key
   WHERE d.id IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % fixture definition(s) not renamed as expected', bad;
  END IF;

  -- The values moved with them, and nothing is left under a system key.
  SELECT count(*) INTO bad FROM places
   WHERE id = 'upgrade-fixture-aca-place'
     AND field_values ->> 'aca_water_2' = 'mine'
     AND field_values ->> 'aca_risk_3' = 'mine too'
     AND field_values ->> 'aca_risk_2' = 'already here'
     AND NOT field_values ? 'aca_water'
     AND NOT field_values ? 'aca_risk'
     AND (field_values ->> 'quality')::int = 4;
  IF bad <> 1 THEN
    RAISE EXCEPTION 'upgrade-check: the fixture place did not take its values to the renamed keys';
  END IF;
END $$;
\endif
DROP SCHEMA upgrade_check_aca CASCADE;
\endif
