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

-- 20261112000000_topo_job_wall_seconds_stamp: every finished job with a
-- started_at ends up with a numeric wallSeconds, the ones that had none get
-- updated_at - started_at, and no updated_at moves. Off once the base has it.
SELECT NOT EXISTS (
  SELECT 1 FROM _prisma_migrations
   WHERE migration_name = '20261112000000_topo_job_wall_seconds_stamp'
) AS stamp_applies \gset
\if :stamp_applies
\if :{?fixtures}
INSERT INTO users (id, subject, username, email) VALUES
  ('upgrade-fixture-x', 'upgrade-fixture-x-sub', 'upgrade_x', 'x@upgrade.invalid');
INSERT INTO topo_jobs (id, user_id, status, started_at, updated_at, pipeline_metrics) VALUES
  ('upgrade-fixture-1', 'upgrade-fixture-x', 'failed',   '2026-01-01 10:00:00', '2026-01-01 12:00:00', NULL),
  ('upgrade-fixture-2', 'upgrade-fixture-x', 'failed',   '2026-01-01 10:00:00', '2026-01-08 12:00:00', 'null'),
  ('upgrade-fixture-3', 'upgrade-fixture-x', 'complete', '2026-01-01 10:00:00', '2026-01-08 12:00:00', '{"phases": {"a": 1}}'),
  ('upgrade-fixture-4', 'upgrade-fixture-x', 'complete', '2026-01-01 10:00:00', '2026-01-08 12:00:00', '{"wallSeconds": 99}'),
  ('upgrade-fixture-5', 'upgrade-fixture-x', 'failed',   NULL,                  '2026-01-08 12:00:00', NULL);
\endif
CREATE SCHEMA IF NOT EXISTS upgrade_check;
CREATE TABLE upgrade_check.topo_jobs AS
  SELECT id, started_at, updated_at, pipeline_metrics FROM topo_jobs
   WHERE status NOT IN ('pending', 'processing');
\endif
