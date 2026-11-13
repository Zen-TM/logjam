-- Migration UPGRADE check, part 1 of 2: runs against the database at the BASE
-- schema (what prod runs today, `origin/main`), after its seed, BEFORE the
-- head's migrations. Captures what the data looks like so verify.sql can
-- assert the migrations did what they say. Driven by
-- scripts/migration-upgrade-test.sh; the same pair runs against a restored
-- prod snapshot for a release rehearsal (without fixtures).
--
-- Why this exists: the `migrations` CI job applies every migration to an EMPTY
-- database, so a migration that mishandles an existing row passes CI and fails,
-- or silently drops data, on prod.
--
-- RELEASE-SPECIFIC. The metrics below describe one release's data-moving
-- migrations and switch themselves off once the base has them; the next
-- release that moves data replaces them. Once the base has the migration
-- named below, this file and verify.sql check nothing;
-- api/src/lib/upgradeCheck.unit.test.ts turns red when a newer migration moves
-- data and neither file names it. The generic half (migrations apply over
-- real rows; the result matches schema.prisma) lives in the script and
-- never goes stale.
--
-- `-v fixtures=1` first inserts made-up rows, so the check has something to
-- see change whatever the base seed holds. CI only, never against a prod
-- copy.

\set ON_ERROR_STOP on

-- 20261114010000_aca_grade_fields: four system field definitions join Canyon.
-- A user's own place definition that already holds one of their keys is renamed
-- `<key>_<n>` and the values it holds move with it; every other definition and
-- scoping row stays as it was. Off once the base has it.
SELECT NOT EXISTS (
  SELECT 1 FROM _prisma_migrations
   WHERE migration_name = '20261114010000_aca_grade_fields'
) AS aca_apply \gset
\if :aca_apply
\if :{?fixtures}
-- One owner holding aca_water, and aca_risk beside an aca_risk_2 of their own, so
-- the rename must pick the first suffix they do not hold (aca_risk_3).
INSERT INTO users (id, subject, username, email) VALUES
  ('upgrade-fixture-aca', 'upgrade-fixture-aca-sub', 'upgrade_aca', 'aca@upgrade.invalid');
INSERT INTO custom_field_defs (id, owner_id, entity, key, label, type, position, updated_at) VALUES
  ('upgrade-fixture-aca-water', 'upgrade-fixture-aca', 'place', 'aca_water', 'ACA water', 'string', 0, CURRENT_TIMESTAMP),
  ('upgrade-fixture-aca-risk', 'upgrade-fixture-aca', 'place', 'aca_risk', 'ACA risk', 'string', 1, CURRENT_TIMESTAMP),
  ('upgrade-fixture-aca-risk-2', 'upgrade-fixture-aca', 'place', 'aca_risk_2', 'ACA risk 2', 'string', 2, CURRENT_TIMESTAMP);
INSERT INTO places (id, owner_id, place_type_id, name, latitude, longitude, field_values, updated_at) VALUES
  ('upgrade-fixture-aca-place', 'upgrade-fixture-aca', 'b0000000-0000-4000-8000-000000000001', 'Fixture canyon', -33.0, 150.0,
   '{"aca_water": "mine", "aca_risk": "mine too", "aca_risk_2": "already here", "quality": 4}', CURRENT_TIMESTAMP);
CREATE SCHEMA IF NOT EXISTS upgrade_check_aca;
CREATE TABLE upgrade_check_aca.fixtures AS SELECT 1 AS one;
\endif
CREATE SCHEMA IF NOT EXISTS upgrade_check_aca;
CREATE TABLE upgrade_check_aca.defs AS
  SELECT id, owner_id, key, label, type, min, max, position FROM custom_field_defs;
CREATE TABLE upgrade_check_aca.scopes AS
  SELECT def_id, place_type_id FROM custom_field_def_place_types;
\endif
