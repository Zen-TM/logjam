-- Migration UPGRADE check, part 2 of 2: runs after the head's migrations, and
-- compares against what baseline.sql captured. See baseline.sql for why and
-- for when these release-specific metrics are replaced. Fails (exit 3) listing
-- EVERY mismatch, not just the first.

\set ON_ERROR_STOP on

SELECT to_regclass('upgrade_check.baseline') IS NOT NULL AS applies \gset
\if :applies

CREATE TEMP TABLE after AS
SELECT * FROM (VALUES
  ('place_types', (SELECT count(*) FROM place_types)),
  ('places',      (SELECT count(*) FROM places))
) AS t(metric, value);

\echo 'upgrade-check after head migrations (base -> after):'
SELECT b.metric, b.value AS base, a.value AS after,
       CASE WHEN a.value IS DISTINCT FROM b.value THEN 'MISMATCH' ELSE 'ok' END AS status
  FROM upgrade_check.baseline b LEFT JOIN after a USING (metric)
 ORDER BY status DESC, b.metric;

DO $$
DECLARE bad TEXT; moved BIGINT;
BEGIN
  SELECT string_agg(format('%s: %s -> %s', b.metric, b.value, coalesce(a.value::text, 'missing')), '; ')
    INTO bad
    FROM upgrade_check.baseline b LEFT JOIN after a USING (metric)
   WHERE a.value IS DISTINCT FROM b.value;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'upgrade-check: data not carried across: %', bad;
  END IF;
  SELECT count(*) INTO moved
    FROM upgrade_check.place_type_of b LEFT JOIN places p USING (id)
   WHERE p.place_type_id IS DISTINCT FROM b.place_type_id;
  IF moved > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % place(s) changed type or went missing', moved;
  END IF;
END $$;

-- Fixture-specific outcomes: the earliest of each set kept its name, the
-- later ones took the next FREE suffix, and the index now refuses another.
-- Mutations: drop the rename loop and the migration fails on CREATE INDEX;
-- drop the index and the insert at the bottom is accepted.
SELECT EXISTS (SELECT 1 FROM users WHERE id = 'upgrade-fixture-owner') AS fixtures \gset
\if :fixtures
DO $$
DECLARE names TEXT[]; untouched BIGINT;
BEGIN
  SELECT array_agg(name ORDER BY id) INTO names
    FROM place_types WHERE owner_id = 'upgrade-fixture-owner';
  IF names IS DISTINCT FROM
     ARRAY['Cave', 'cave (3)', 'Cave (2)', 'CAVE (4)', 'canyon (2)', 'Hut'] THEN
    RAISE EXCEPTION 'upgrade-check: fixture place type names wrong: %', names;
  END IF;
  -- A renamed row is bumped for the delta pull; one left alone is not.
  SELECT count(*) INTO untouched
    FROM place_types
   WHERE owner_id = 'upgrade-fixture-owner' AND updated_at < '2026-02-01';
  IF untouched <> 3 THEN
    RAISE EXCEPTION 'upgrade-check: expected 3 fixture types left untouched, found %', untouched;
  END IF;
  BEGIN
    INSERT INTO place_types (id, owner_id, name, icon_key, color, updated_at)
    VALUES ('upgrade-fixture-type-7', 'upgrade-fixture-owner', '  hUT', 'map-pin', '#F97316', now());
    RAISE EXCEPTION 'upgrade-check: the as-read index accepted a duplicate name';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
\echo 'upgrade-check: fixture duplicates renamed, places kept, index refuses another'
\endif

DROP SCHEMA upgrade_check CASCADE;
\echo 'upgrade-check: data carried across'

\else
\echo 'upgrade-check: no baseline captured — release-specific checks skipped.'
\endif
