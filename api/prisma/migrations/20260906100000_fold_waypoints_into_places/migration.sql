-- Places rework, phase 1c: waypoints stop being their own entity.
--
-- A waypoint and a canyon were always "a named point with alt-names, coords,
-- notes and an owner". The differences were seven nullable columns on one side
-- and tags plus a never-written `symbol` on the other. Every waypoint becomes a
-- place of the system MARKER type, and the canyon<->waypoint join becomes a
-- symmetric place<->place LINK that grants no visibility at all.
--
-- NOT expand/contract-safe (api/CLAUDE.md), as in 1a and 1b: the deployed image
-- reads a `waypoints` table that stops existing. The prod apply is the
-- operator's, with the API stopped.
--
-- ACCEPTED BEHAVIOUR CHANGE (plan §4 step 15): a waypoint that was visible to a
-- canyon's sharees THROUGH the join table loses that visibility, because a
-- PlaceLink grants none. Narrowing is the safe direction and the root CLAUDE.md
-- forbids the other one. Explicit shares are NOT minted to preserve it.

-- ── what a place gains from a waypoint ──────────────────────────────────────
-- `elevation` is STRUCTURAL — every point on earth has one — so it is a column
-- rather than a field definition. It is live on every waypoint surface today,
-- and dropping it here would be silent data loss.
ALTER TABLE "places" ADD COLUMN "elevation" DOUBLE PRECISION;
ALTER TABLE "places" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ── place <-> place links ───────────────────────────────────────────────────
CREATE TABLE "place_links" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "a_place_id" TEXT NOT NULL,
    "b_place_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "place_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "place_links_owner_id_a_place_id_b_place_id_key"
    ON "place_links"("owner_id", "a_place_id", "b_place_id");
CREATE INDEX "place_links_owner_id_updated_at_idx" ON "place_links"("owner_id", "updated_at");
CREATE INDEX "place_links_b_place_id_idx" ON "place_links"("b_place_id");
ALTER TABLE "place_links" ADD CONSTRAINT "place_links_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "place_links" ADD CONSTRAINT "place_links_a_place_id_fkey"
    FOREIGN KEY ("a_place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "place_links" ADD CONSTRAINT "place_links_b_place_id_fkey"
    FOREIGN KEY ("b_place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── every waypoint becomes a place of the Marker type ───────────────────────
-- IDS ARE PRESERVED, so every FK below repoints by id with no mapping table —
-- and so does every notification payload, every outbox op that survived, and
-- every id a client already holds.
--
-- `symbol` is DROPPED. mobile/src/map/waypointSymbol.ts said outright that it
-- "has existed since the waypoint model landed and nothing ever wrote it";
-- carrying it forward as a per-place icon override would mean a second,
-- unguarded icon-key namespace with no UI. The type's icon is the icon.
INSERT INTO "places" (
    "id", "owner_id", "place_type_id", "name", "altNames", "latitude",
    "longitude", "elevation", "tags", "notes", "field_values",
    "created_at", "updated_at"
)
SELECT
    w."id",
    w."owner_id",
    'b0000000-0000-4000-8000-000000000003',  -- the system Marker type
    w."name",
    ARRAY[]::TEXT[],
    w."latitude",
    w."longitude",
    w."elevation",
    w."tags",
    w."notes",
    '{}'::jsonb,
    w."created_at",
    w."updated_at"
FROM "waypoints" w;

-- Fail LOUDLY rather than lose a row. A waypoint whose id somehow collided with
-- a place id would have been swallowed by the insert above.
DO $$
DECLARE expected INT; actual INT;
BEGIN
  SELECT count(*) INTO expected FROM waypoints;
  SELECT count(*) INTO actual FROM places
   WHERE place_type_id = 'b0000000-0000-4000-8000-000000000003';
  IF actual < expected THEN
    RAISE EXCEPTION 'places rework: % waypoints but only % markers — ids collided', expected, actual;
  END IF;
END $$;

-- ── the canyon<->waypoint join becomes a symmetric place link ───────────────
-- Canonical low-id/high-id ordering, so "stored once" is enforced by the unique
-- index rather than by convention, and DISTINCT because two rows that differ
-- only in direction are one link.
--
-- `owner_id` comes from the PLACE's owner. A link whose two endpoints have
-- different owners is dropped rather than assigned to one of them: it cannot
-- exist today (a waypoint is owner-private and only its owner could link it),
-- and inventing an owner for one would put a row in someone's delta that they
-- did not create.
INSERT INTO "place_links" ("id", "owner_id", "a_place_id", "b_place_id", "created_at", "updated_at")
SELECT
    gen_random_uuid()::text,
    p."owner_id",
    LEAST(pw."place_id", pw."waypoint_id"),
    GREATEST(pw."place_id", pw."waypoint_id"),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT
        LEAST("place_id", "waypoint_id") AS "place_id",
        GREATEST("place_id", "waypoint_id") AS "waypoint_id"
    FROM "place_waypoints"
) pw
JOIN "places" p ON p."id" = pw."place_id"
JOIN "places" q ON q."id" = pw."waypoint_id"
WHERE p."owner_id" = q."owner_id"
ON CONFLICT DO NOTHING;

-- ── the polymorphic share table ─────────────────────────────────────────────
-- §4 step 11. A directly-shared waypoint lived in `shares`, NOT in
-- canyon_shares, so nothing else in this migration touches it — and left behind
-- it is an orphan row pointing at a dead entity type that
-- `Share.@@unique([entityType, entityId, sharedWithId])` keeps alive forever.
-- Converted rather than deleted: the recipient can still see the thing, it is
-- just a place now.
INSERT INTO "place_shares" ("id", "place_id", "shared_by_id", "shared_with_id", "created_at")
SELECT gen_random_uuid()::text, s."entity_id", s."shared_by_id", s."shared_with_id", s."created_at"
FROM "shares" s
JOIN "places" p ON p."id" = s."entity_id"
WHERE s."entity_type" = 'waypoint'
ON CONFLICT DO NOTHING;

DELETE FROM "shares" WHERE "entity_type" = 'waypoint';

-- ── notifications ───────────────────────────────────────────────────────────
-- §4 step 12, and it is a TYPE change, not a payload edit.
--
-- The share itself moved tables above (`shares` → `place_shares`), and
-- `item_shared` is read-gated on a live `Share` row keyed
-- `<entityType>:<entityId>:<recipient>` (routes/notifications.ts). Rewriting
-- only `payload.entityType` would leave a row whose gate can never match: the
-- recipient sees nothing, and the row sits at rest forever — the PRIV-001 shape
-- this codebase deletes shares' residue to avoid.
--
-- So the row becomes the notification the same grant would raise today: a
-- `place_shared` pointing at the place, keyed the way the place path keys it
-- (`placeId`, `sharedById`), which is gated on a live PlaceShare — the row the
-- conversion above just created.
UPDATE "notifications"
   SET "type" = 'place_shared',
       "payload" = jsonb_build_object(
         'placeId', "payload" ->> 'entityId',
         'sharedById', "payload" ->> 'sharedById'
       )
 WHERE "type" = 'item_shared'
   AND "payload" ->> 'entityType' = 'waypoint'
   AND EXISTS (SELECT 1 FROM "places" p WHERE p."id" = "payload" ->> 'entityId');

-- Anything left naming a waypoint has no place to point at (the entity is gone
-- entirely, or was never a row we converted). A tap that goes nowhere is worse
-- than no row: the read-time gate already hides it, and this removes it at rest.
DELETE FROM "notifications"
 WHERE "payload" ->> 'entityType' = 'waypoint';

-- ── drop the old shape ──────────────────────────────────────────────────────
DROP TABLE "place_waypoints";
DROP TABLE "waypoints";

-- ── sync vocabulary ─────────────────────────────────────────────────────────
-- `waypoint` leaves SYNC_ENTITY_TYPES and `placeLink` joins it. Tombstones are
-- keyed by that vocabulary and no client can resume a cursor across this.
DELETE FROM "sync_tombstones";
