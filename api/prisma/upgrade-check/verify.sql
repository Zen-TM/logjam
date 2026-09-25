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
  -- The base has no waypoints, so every place is a migrated canyon.
  ('places',            (SELECT count(*) FROM places
                          WHERE place_type_id = 'b0000000-0000-4000-8000-000000000001')),
  ('place_shares',      (SELECT count(*) FROM place_shares)),
  ('trip_logs',         (SELECT count(*) FROM trip_logs)),
  ('trip_log_places',   (SELECT count(*) FROM trip_log_places)),
  ('friendships',       (SELECT count(*) FROM friendships)),
  ('notifications',     (SELECT count(*) FROM notifications)),
  ('place_shared_notes',(SELECT count(*) FROM notifications
                          WHERE type = 'place_shared' AND payload ? 'placeId' AND NOT payload ? 'canyonId')),
  ('media',             (SELECT count(*) FROM media)),
  ('media_on_places',   (SELECT count(*) FROM media WHERE linked_type = 'place')),
  ('geo_pdf_marker_cfg',(SELECT count(*) FROM geo_pdf_templates
                          WHERE config ? 'placeMarkers' AND NOT config ? 'canyonMarkers')),
  ('user_field_defs',   (SELECT count(*) FROM custom_field_defs WHERE owner_id IS NOT NULL)),
  ('v_grade',           (SELECT count(*) FROM places WHERE field_values ? 'v_grade')),
  ('a_grade',           (SELECT count(*) FROM places WHERE field_values ? 'a_grade')),
  ('commitment',        (SELECT count(*) FROM places WHERE field_values ? 'commitment')),
  ('quality',           (SELECT count(*) FROM places WHERE field_values ? 'quality')),
  ('hours',             (SELECT count(*) FROM places WHERE field_values ? 'hours')),
  ('num_abseils',       (SELECT count(*) FROM places WHERE field_values ? 'num_abseils')),
  ('longest_abseil',    (SELECT count(*) FROM places WHERE field_values ? 'longest_abseil')),
  ('_sources',          (SELECT count(*) FROM places WHERE field_values ? '_sources')),
  ('custom_values',     (SELECT count(*) FROM places, jsonb_object_keys(field_values) AS k
                          WHERE k NOT IN ('v_grade', 'a_grade', 'commitment', 'quality', 'hours',
                                          'num_abseils', 'longest_abseil', '_sources')))
) AS t(metric, value);

\echo 'upgrade-check after head migrations (base -> after):'
SELECT b.metric, b.value AS base, a.value AS after,
       CASE WHEN a.value IS DISTINCT FROM b.value THEN 'MISMATCH' ELSE 'ok' END AS status
  FROM upgrade_check.baseline b LEFT JOIN after a USING (metric)
 ORDER BY status DESC, b.metric;

DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(format('%s: %s -> %s', b.metric, b.value, coalesce(a.value::text, 'missing')), '; ')
    INTO bad
    FROM upgrade_check.baseline b LEFT JOIN after a USING (metric)
   WHERE a.value IS DISTINCT FROM b.value;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'upgrade-check: data not carried across: %', bad;
  END IF;
END $$;

-- Fixture-specific outcomes: the reserved-key collisions were renamed with
-- their values, not overwritten or dropped.
SELECT EXISTS (SELECT 1 FROM users WHERE id = 'upgrade-fixture-owner') AS fixtures \gset
\if :fixtures
DO $$
DECLARE fv JSONB; defs TEXT[];
BEGIN
  SELECT field_values INTO fv FROM places WHERE id = 'upgrade-fixture-graded';
  SELECT array_agg(key ORDER BY key) INTO defs
    FROM custom_field_defs WHERE owner_id = 'upgrade-fixture-owner';
  IF fv ->> 'capacity_2' IS DISTINCT FROM '5' OR fv ? 'capacity'
     OR fv ->> 'has_water_2' IS DISTINCT FROM 'true' OR fv ? 'has_water'
     OR fv ->> 'rope' IS DISTINCT FROM '60'
     OR fv ->> 'v_grade' IS DISTINCT FROM '3' OR fv ->> 'longest_abseil' IS DISTINCT FROM '25.5' THEN
    RAISE EXCEPTION 'upgrade-check: fixture place field_values wrong: %', fv;
  END IF;
  IF defs IS DISTINCT FROM ARRAY['capacity_2', 'has_water_2', 'party', 'rope'] THEN
    RAISE EXCEPTION 'upgrade-check: fixture field definitions wrong: %', defs;
  END IF;
END $$;
\echo 'upgrade-check: fixture collisions renamed with their values'
\endif

DROP SCHEMA upgrade_check CASCADE;
\echo 'upgrade-check: data carried across'

\else
\echo 'upgrade-check: no baseline captured — release-specific checks skipped.'
\endif
