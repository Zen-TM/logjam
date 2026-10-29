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

-- 20261030000000_drop_geo_pdf_jobs: a straggler GeoPDF job (completed by the old
-- image after the earlier delete) goes with its share and notification, its
-- storage charge is given back, and the table is dropped. Off once the base has
-- it.
SELECT NOT EXISTS (
  SELECT 1 FROM _prisma_migrations
   WHERE migration_name = '20261030000000_drop_geo_pdf_jobs'
) AS geo_pdf_applies \gset
\if :geo_pdf_applies
\if :{?fixtures}
INSERT INTO users (id, cognito_id, username, email, storage_used_bytes) VALUES
  ('upgrade-fixture-x', 'upgrade-fixture-x-sub', 'upgrade_x', 'x@upgrade.invalid', 5000),
  ('upgrade-fixture-y', 'upgrade-fixture-y-sub', 'upgrade_y', 'y@upgrade.invalid', 0);
INSERT INTO geo_pdf_jobs (id, user_id, config, vector_style_snapshot, status, result_bytes) VALUES
  ('upgrade-fixture-pdf-1', 'upgrade-fixture-x', '{}', '{}', 'completed', 1500),
  ('upgrade-fixture-pdf-2', 'upgrade-fixture-x', '{}', '{}', 'completed', 1000),
  ('upgrade-fixture-pdf-3', 'upgrade-fixture-x', '{}', '{}', 'failed', NULL),
  ('upgrade-fixture-pdf-4', 'upgrade-fixture-y', '{}', '{}', 'completed', 9000);
INSERT INTO shares (id, entity_type, entity_id, shared_by_id, shared_with_id) VALUES
  ('upgrade-fixture-share-1', 'geoPdfJob', 'upgrade-fixture-pdf-1', 'upgrade-fixture-x', 'upgrade-fixture-y'),
  ('upgrade-fixture-share-2', 'route', 'upgrade-fixture-route', 'upgrade-fixture-x', 'upgrade-fixture-y');
INSERT INTO notifications (id, user_id, type, payload) VALUES
  ('upgrade-fixture-note-1', 'upgrade-fixture-y', 'geo_pdf_complete', '{}'),
  ('upgrade-fixture-note-2', 'upgrade-fixture-y', 'announcement', '{}');
\endif
CREATE SCHEMA IF NOT EXISTS upgrade_check;
CREATE TABLE upgrade_check.geo_pdf_uncharge AS
SELECT u.id AS user_id,
       GREATEST(0, u.storage_used_bytes - coalesce(sum(g.result_bytes) FILTER (WHERE g.status = 'completed'), 0)) AS expected
  FROM users u LEFT JOIN geo_pdf_jobs g ON g.user_id = u.id
 GROUP BY u.id, u.storage_used_bytes;
CREATE TABLE upgrade_check.kept AS
SELECT (SELECT count(*) FROM shares WHERE entity_type <> 'geoPdfJob') AS shares,
       (SELECT count(*) FROM notifications WHERE type <> 'geo_pdf_complete') AS notifications;
\endif
