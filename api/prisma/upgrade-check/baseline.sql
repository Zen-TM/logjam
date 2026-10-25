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

-- 20261025120000_topo_export_uncharge: live completed exports were charged to
-- storage, and the migration gives that back. Off once the base has it.
SELECT NOT EXISTS (
  SELECT 1 FROM _prisma_migrations
   WHERE migration_name = '20261025120000_topo_export_uncharge'
) AS uncharge_applies \gset
\if :uncharge_applies
\if :{?fixtures}
INSERT INTO users (id, cognito_id, username, email, storage_used_bytes) VALUES
  ('upgrade-fixture-x', 'upgrade-fixture-x-sub', 'upgrade_x', 'x@upgrade.invalid', 5000);
INSERT INTO topo_export_jobs (id, user_id, status, format, bundling, layers, source_job_ids, vector_style_snapshot, result_bytes) VALUES
  ('upgrade-fixture-export-1', 'upgrade-fixture-x', 'completed', 'geotiff', 'per-layer', '{}', '{}', '{}', 1500),
  ('upgrade-fixture-export-2', 'upgrade-fixture-x', 'completed', 'geotiff', 'per-layer', '{}', '{}', '{}', 1000),
  ('upgrade-fixture-export-3', 'upgrade-fixture-x', 'failed',    'geotiff', 'per-layer', '{}', '{}', '{}', NULL);
\endif
CREATE SCHEMA IF NOT EXISTS upgrade_check;
CREATE TABLE upgrade_check.export_uncharge AS
SELECT u.id AS user_id,
       GREATEST(0, u.storage_used_bytes - coalesce(sum(e.result_bytes) FILTER (WHERE e.status = 'completed'), 0)) AS expected
  FROM users u LEFT JOIN topo_export_jobs e ON e.user_id = u.id
 GROUP BY u.id, u.storage_used_bytes;
\endif
