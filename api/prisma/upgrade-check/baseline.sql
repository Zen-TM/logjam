-- Migration UPGRADE check, part 1 of 2: runs against the database at the BASE
-- schema (what prod runs today — `origin/main`), after its seed, BEFORE the
-- head's migrations. Captures what the data looks like so verify.sql can
-- assert the migrations carried it across. Driven by
-- scripts/migration-upgrade-test.sh; the same pair runs against a restored
-- prod snapshot for a release rehearsal (without fixtures).
--
-- Why this exists: the `migrations` CI job applies every migration to an EMPTY
-- database, so a migration that mishandles an existing row (a backfill that
-- misses one, a SET NOT NULL over a null, a rename collision) passes CI and
-- fails — or silently drops data — on prod.
--
-- RELEASE-SPECIFIC. The metrics below describe
-- 20261010120000_place_type_name_unique_as_read, which renames a user's
-- duplicate place type names before indexing them. They switch themselves off
-- once the base schema has that index; the next release that moves data
-- replaces them. The generic half (migrations apply over real rows; the result
-- matches schema.prisma) lives in the script and never goes stale.
--
-- `-v fixtures=1` first inserts edge cases the seed does not have: names that
-- differ only in case or spacing, one whose "(2)" is already taken, one that
-- shadows a built-in. CI only — never against a prod copy.

\set ON_ERROR_STOP on

SELECT to_regclass('public.place_types_owner_id_name_as_read_key') IS NULL AS applies \gset
\if :applies

\if :{?fixtures}
INSERT INTO users (id, cognito_id, username, email) VALUES
  ('upgrade-fixture-owner', 'upgrade-fixture-owner-sub', 'upgrade_owner', 'owner@upgrade.invalid');

INSERT INTO place_types (id, owner_id, name, icon_key, color, created_at, updated_at) VALUES
  ('upgrade-fixture-type-1', 'upgrade-fixture-owner', 'Cave',     'map-pin', '#F97316', '2026-01-01', '2026-01-01'),
  ('upgrade-fixture-type-2', 'upgrade-fixture-owner', 'cave',     'map-pin', '#F97316', '2026-01-02', '2026-01-02'),
  ('upgrade-fixture-type-3', 'upgrade-fixture-owner', 'Cave (2)', 'map-pin', '#F97316', '2026-01-03', '2026-01-03'),
  ('upgrade-fixture-type-4', 'upgrade-fixture-owner', ' CAVE ',   'map-pin', '#F97316', '2026-01-04', '2026-01-04'),
  ('upgrade-fixture-type-5', 'upgrade-fixture-owner', 'canyon',   'map-pin', '#F97316', '2026-01-05', '2026-01-05'),
  ('upgrade-fixture-type-6', 'upgrade-fixture-owner', 'Hut',      'map-pin', '#F97316', '2026-01-06', '2026-01-06');

INSERT INTO places (id, owner_id, place_type_id, name, latitude, longitude, updated_at) VALUES
  ('upgrade-fixture-place', 'upgrade-fixture-owner', 'upgrade-fixture-type-2', 'Made up', -33.6, 150.3, now());
\endif

DROP SCHEMA IF EXISTS upgrade_check CASCADE;
CREATE SCHEMA upgrade_check;

CREATE TABLE upgrade_check.baseline AS
SELECT * FROM (VALUES
  ('place_types', (SELECT count(*) FROM place_types)),
  ('places',      (SELECT count(*) FROM places))
) AS t(metric, value);

-- A rename must never move a place to another type.
CREATE TABLE upgrade_check.place_type_of AS
SELECT id, place_type_id FROM places;

\echo 'upgrade-check baseline captured:'
SELECT metric, value FROM upgrade_check.baseline ORDER BY metric;

\else
\echo 'upgrade-check: base already has the as-read name index — these checks no longer apply; replace them for this release.'
\endif
