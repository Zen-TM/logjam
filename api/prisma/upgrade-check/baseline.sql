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
-- release that moves data replaces them. The generic half (migrations apply
-- over real rows; the result matches schema.prisma) lives in the script and
-- never goes stale.
--
-- `-v fixtures=1` first inserts made-up rows, so the check has something to
-- see change whatever the base seed holds. CI only, never against a prod
-- copy.

\set ON_ERROR_STOP on

-- 20261101000100_user_subject_not_null: a user the previous image created while
-- the base's migration applied has no subject; the migration fills it from
-- cognito_id, then makes the column NOT NULL. Off once the base has it.
SELECT NOT EXISTS (
  SELECT 1 FROM _prisma_migrations
   WHERE migration_name = '20261101000100_user_subject_not_null'
) AS subject_applies \gset
\if :subject_applies
\if :{?fixtures}
-- One row the old image made (cognito_id only), one it rebound (a stale
-- subject), one that already has both.
INSERT INTO users (id, cognito_id, subject, username, email) VALUES
  ('upgrade-fixture-x', 'upgrade-fixture-x-sub', NULL, 'upgrade_x', 'x@upgrade.invalid'),
  ('upgrade-fixture-z', 'upgrade-fixture-z-new', 'upgrade-fixture-z-old', 'upgrade_z', 'z@upgrade.invalid'),
  ('upgrade-fixture-y', 'upgrade-fixture-y-sub', 'upgrade-fixture-y-sub', 'upgrade_y', 'y@upgrade.invalid');
\endif
CREATE SCHEMA IF NOT EXISTS upgrade_check;
CREATE TABLE upgrade_check.users AS SELECT id, cognito_id FROM users;
\endif
