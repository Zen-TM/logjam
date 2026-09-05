-- Places rework, phase 1a: rename canyon -> place. NO data movement, NO shape
-- change: `canyons` becomes `places`, and every FK column, index and constraint
-- that named a canyon now names a place. The seven grade columns stay columns
-- here; they become `field_values` keys in phase 1b.
--
-- HAND-WRITTEN ON PURPOSE. `prisma migrate dev` does not detect renames — it
-- emits DROP TABLE canyons + CREATE TABLE places, which would destroy every
-- prod row. Every statement below is a rename, so ids and rows are preserved.
--
-- NOT expand/contract-safe (api/CLAUDE.md): the currently-deployed image reads
-- `canyons`, so it breaks the moment this applies. That is inherent to the
-- rework and accepted — the whole entity is renamed, and there is no shape both
-- images tolerate. The prod apply is the operator's, with the API stopped.

-- ── tables ──────────────────────────────────────────────────────────────────
ALTER TABLE "canyons" RENAME TO "places";
ALTER TABLE "canyon_shares" RENAME TO "place_shares";
ALTER TABLE "trip_log_canyons" RENAME TO "trip_log_places";
ALTER TABLE "canyon_waypoints" RENAME TO "place_waypoints";

-- ── columns ─────────────────────────────────────────────────────────────────
ALTER TABLE "place_shares" RENAME COLUMN "canyon_id" TO "place_id";
ALTER TABLE "trip_log_places" RENAME COLUMN "canyon_id" TO "place_id";
ALTER TABLE "place_waypoints" RENAME COLUMN "canyon_id" TO "place_id";
ALTER TABLE "routes" RENAME COLUMN "canyon_id" TO "place_id";
-- Dead column (never read or written; @deprecated in the schema). Renamed
-- rather than dropped: phase 1c deletes it with the waypoints table fold.
ALTER TABLE "waypoints" RENAME COLUMN "canyon_id" TO "place_id";

-- ── primary keys and unique/plain indexes ───────────────────────────────────
-- Postgres does not rename an index when its table is renamed, and Prisma's
-- drift check compares index names, so each one is renamed explicitly.
ALTER INDEX "canyons_pkey" RENAME TO "places_pkey";
ALTER INDEX "canyons_owner_id_idx" RENAME TO "places_owner_id_idx";
ALTER INDEX "canyons_owner_id_import_batch_id_idx" RENAME TO "places_owner_id_import_batch_id_idx";
ALTER INDEX "canyons_owner_id_import_key_key" RENAME TO "places_owner_id_import_key_key";
ALTER INDEX "canyons_owner_id_ropewiki_id_key" RENAME TO "places_owner_id_ropewiki_id_key";

ALTER INDEX "canyon_shares_pkey" RENAME TO "place_shares_pkey";
ALTER INDEX "canyon_shares_canyon_id_idx" RENAME TO "place_shares_place_id_idx";
ALTER INDEX "canyon_shares_shared_by_id_idx" RENAME TO "place_shares_shared_by_id_idx";
ALTER INDEX "canyon_shares_shared_with_id_idx" RENAME TO "place_shares_shared_with_id_idx";

ALTER INDEX "trip_log_canyons_pkey" RENAME TO "trip_log_places_pkey";
ALTER INDEX "trip_log_canyons_canyon_id_idx" RENAME TO "trip_log_places_place_id_idx";

ALTER INDEX "canyon_waypoints_pkey" RENAME TO "place_waypoints_pkey";
ALTER INDEX "canyon_waypoints_waypoint_id_idx" RENAME TO "place_waypoints_waypoint_id_idx";

ALTER INDEX "routes_canyon_id_key" RENAME TO "routes_place_id_key";

-- ── foreign keys ────────────────────────────────────────────────────────────
ALTER TABLE "places" RENAME CONSTRAINT "canyons_forked_from_id_fkey" TO "places_forked_from_id_fkey";
ALTER TABLE "places" RENAME CONSTRAINT "canyons_owner_id_fkey" TO "places_owner_id_fkey";

ALTER TABLE "place_shares" RENAME CONSTRAINT "canyon_shares_canyon_id_fkey" TO "place_shares_place_id_fkey";
ALTER TABLE "place_shares" RENAME CONSTRAINT "canyon_shares_shared_by_id_fkey" TO "place_shares_shared_by_id_fkey";
ALTER TABLE "place_shares" RENAME CONSTRAINT "canyon_shares_shared_with_id_fkey" TO "place_shares_shared_with_id_fkey";

ALTER TABLE "trip_log_places" RENAME CONSTRAINT "trip_log_canyons_canyon_id_fkey" TO "trip_log_places_place_id_fkey";
ALTER TABLE "trip_log_places" RENAME CONSTRAINT "trip_log_canyons_trip_log_id_fkey" TO "trip_log_places_trip_log_id_fkey";

ALTER TABLE "place_waypoints" RENAME CONSTRAINT "canyon_waypoints_canyon_id_fkey" TO "place_waypoints_place_id_fkey";
ALTER TABLE "place_waypoints" RENAME CONSTRAINT "canyon_waypoints_waypoint_id_fkey" TO "place_waypoints_waypoint_id_fkey";

ALTER TABLE "waypoints" RENAME CONSTRAINT "waypoints_canyon_id_fkey" TO "waypoints_place_id_fkey";
ALTER TABLE "routes" RENAME CONSTRAINT "routes_canyon_id_fkey" TO "routes_place_id_fkey";

-- ── stored vocabulary ───────────────────────────────────────────────────────
UPDATE "media" SET "linked_type" = 'place' WHERE "linked_type" = 'canyon';
UPDATE "custom_field_defs" SET "entity" = 'place' WHERE "entity" = 'canyon';
UPDATE "notifications" SET "type" = 'place_shared' WHERE "type" = 'canyon_shared';
-- Notification payloads carry the entity id and name under canyon-named keys;
-- notificationDestination/tapTarget read the renamed ones, so an unconverted
-- row becomes a dead tap.
UPDATE "notifications"
   SET "payload" = ("payload" - 'canyonId') || jsonb_build_object('placeId', "payload" -> 'canyonId')
 WHERE "payload" ? 'canyonId';
UPDATE "notifications"
   SET "payload" = ("payload" - 'canyonName') || jsonb_build_object('placeName', "payload" -> 'canyonName')
 WHERE "payload" ? 'canyonName';
UPDATE "notifications"
   SET "payload" = jsonb_set("payload", '{entityType}', '"place"')
 WHERE "payload" ->> 'entityType' = 'canyon';
-- GeoPDF templates store the marker layer under a canyon-named key.
-- validateGeoPdfConfigCore is key-OPTIONAL, so an unconverted template
-- validates fine and silently renders no markers (plan §4 step 13).
UPDATE "geo_pdf_templates"
   SET "config" = ("config" - 'canyonMarkers') || jsonb_build_object('placeMarkers', "config" -> 'canyonMarkers')
 WHERE "config" ? 'canyonMarkers';

-- ── sync vocabulary ─────────────────────────────────────────────────────────
-- SYNC_ENTITY_TYPES loses 'canyon'/'canyonShare'. Tombstone rows are keyed by
-- that vocabulary, and no client holds a cursor across this rename, so the log
-- is emptied rather than translated (plan §4 step 14).
DELETE FROM "sync_tombstones";
