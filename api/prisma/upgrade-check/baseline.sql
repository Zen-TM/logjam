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

-- 20261113000000_launch_limit_defaults: every account ends up with 800 compute
-- credits and 10 GiB of download quota, overrides included. Off once the base
-- has it.
SELECT NOT EXISTS (
  SELECT 1 FROM _prisma_migrations
   WHERE migration_name = '20261113000000_launch_limit_defaults'
) AS limits_apply \gset
\if :limits_apply
\if :{?fixtures}
INSERT INTO users (id, subject, username, email, monthly_compute_credits, monthly_egress_quota_bytes) VALUES
  ('upgrade-fixture-x', 'upgrade-fixture-x-sub', 'upgrade_x', 'x@upgrade.invalid', 5000, 107374182400);
\endif
CREATE SCHEMA IF NOT EXISTS upgrade_check;
CREATE TABLE upgrade_check.users AS SELECT id FROM users;
\endif
