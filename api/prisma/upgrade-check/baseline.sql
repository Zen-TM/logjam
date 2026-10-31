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

-- 20261031000000_delete_orphan_share_notifications: a place_shared or
-- item_shared notification whose share is gone is deleted, and nothing else.
-- Off once the base has it.
SELECT NOT EXISTS (
  SELECT 1 FROM _prisma_migrations
   WHERE migration_name = '20261031000000_delete_orphan_share_notifications'
) AS orphans_apply \gset
\if :orphans_apply
\if :{?fixtures}
INSERT INTO users (id, cognito_id, username, email) VALUES
  ('upgrade-fixture-x', 'upgrade-fixture-x-sub', 'upgrade_x', 'x@upgrade.invalid'),
  ('upgrade-fixture-y', 'upgrade-fixture-y-sub', 'upgrade_y', 'y@upgrade.invalid');
INSERT INTO places (id, owner_id, place_type_id, name, latitude, longitude, updated_at) VALUES
  ('upgrade-fixture-place-shared', 'upgrade-fixture-x', 'b0000000-0000-4000-8000-000000000001', 'Made-up shared', -33.7, 150.3, now()),
  ('upgrade-fixture-place-unshared', 'upgrade-fixture-x', 'b0000000-0000-4000-8000-000000000001', 'Made-up revoked', -33.7, 150.3, now());
INSERT INTO place_shares (id, place_id, shared_by_id, shared_with_id) VALUES
  ('upgrade-fixture-place-share', 'upgrade-fixture-place-shared', 'upgrade-fixture-x', 'upgrade-fixture-y');
INSERT INTO shares (id, entity_type, entity_id, shared_by_id, shared_with_id) VALUES
  ('upgrade-fixture-share', 'route', 'upgrade-fixture-route', 'upgrade-fixture-x', 'upgrade-fixture-y');
INSERT INTO notifications (id, user_id, type, payload) VALUES
  ('upgrade-fixture-live-place', 'upgrade-fixture-y', 'place_shared', '{"placeId": "upgrade-fixture-place-shared", "sharedById": "upgrade-fixture-x"}'),
  ('upgrade-fixture-orphan-place', 'upgrade-fixture-y', 'place_shared', '{"placeId": "upgrade-fixture-place-unshared", "sharedById": "upgrade-fixture-x"}'),
  ('upgrade-fixture-live-item', 'upgrade-fixture-y', 'item_shared', '{"entityType": "route", "entityId": "upgrade-fixture-route", "sharedById": "upgrade-fixture-x"}'),
  ('upgrade-fixture-orphan-item', 'upgrade-fixture-y', 'item_shared', '{"entityType": "route", "entityId": "upgrade-fixture-gone", "sharedById": "upgrade-fixture-x"}'),
  -- Shared, but with y, not x: an orphan only the recipient condition finds.
  ('upgrade-fixture-orphan-place-x', 'upgrade-fixture-x', 'place_shared', '{"placeId": "upgrade-fixture-place-shared", "sharedById": "upgrade-fixture-y"}'),
  ('upgrade-fixture-orphan-item-x', 'upgrade-fixture-x', 'item_shared', '{"entityType": "route", "entityId": "upgrade-fixture-route", "sharedById": "upgrade-fixture-y"}'),
  ('upgrade-fixture-other', 'upgrade-fixture-y', 'announcement', '{}');
\endif
CREATE SCHEMA IF NOT EXISTS upgrade_check;
-- Written as joins, not the migration's NOT EXISTS, so the two can disagree.
CREATE TABLE upgrade_check.orphan AS
SELECT n.id FROM notifications n
  LEFT JOIN place_shares ps
    ON n.type = 'place_shared' AND ps.place_id = n.payload ->> 'placeId'
   AND ps.shared_with_id = n.user_id
  LEFT JOIN shares s
    ON n.type = 'item_shared' AND s.entity_type = n.payload ->> 'entityType'
   AND s.entity_id = n.payload ->> 'entityId' AND s.shared_with_id = n.user_id
 WHERE (n.type = 'place_shared' AND ps.id IS NULL)
    OR (n.type = 'item_shared' AND s.id IS NULL);
CREATE TABLE upgrade_check.kept AS
SELECT id FROM notifications WHERE id NOT IN (SELECT id FROM upgrade_check.orphan);
\endif
