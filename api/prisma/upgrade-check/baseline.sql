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
-- RELEASE-SPECIFIC. The metrics below describe
-- 20261025200000_delete_geo_pdf_templates, which deletes every GeoPDF template
-- row. They switch themselves off once the base has that migration; the next
-- release that moves data replaces them. The generic half (migrations apply
-- over real rows; the result matches schema.prisma) lives in the script and
-- never goes stale.
--
-- `-v fixtures=1` first inserts a template of a made-up user, so the check has
-- a row to see go whatever the base seed holds. CI only, never against a prod
-- copy.

\set ON_ERROR_STOP on

SELECT NOT EXISTS (
  SELECT 1 FROM _prisma_migrations
   WHERE migration_name = '20261025200000_delete_geo_pdf_templates'
) AS applies \gset
\if :applies

\if :{?fixtures}
INSERT INTO users (id, cognito_id, username, email) VALUES
  ('upgrade-fixture-a', 'upgrade-fixture-a-sub', 'upgrade_a', 'a@upgrade.invalid');
INSERT INTO geo_pdf_templates (id, user_id, name, config, updated_at) VALUES
  ('upgrade-fixture-template', 'upgrade-fixture-a', 'Made-up layout',
   '{"paperSize": "A4", "orientation": "portrait", "scale": 25000, "baseLayer": "six-topo", "overlays": [], "elements": {"compass": true, "scaleText": true, "scaleBar": true}}', now());
\endif

CREATE SCHEMA upgrade_check;
CREATE TABLE upgrade_check.baseline AS
SELECT * FROM (VALUES
  ('users',                (SELECT count(*) FROM users)),
  ('geo_pdf_templates',    (SELECT count(*) FROM geo_pdf_templates))
) AS t(metric, value);

\echo 'upgrade-check baseline captured:'
SELECT metric, value FROM upgrade_check.baseline ORDER BY metric;

\else
\echo 'upgrade-check: base already has the template-deleting migration — these checks no longer apply; replace them for this release.'
\endif

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
