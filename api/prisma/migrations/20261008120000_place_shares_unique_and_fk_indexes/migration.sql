-- One share per (place, recipient), and an index on three foreign keys.
--
-- EXPAND-ONLY as far as the running API is concerned: the old image's
-- check-then-insert still works (a raced duplicate now fails its insert
-- instead of landing a second row), and `createMany({ skipDuplicates })` in
-- the bulk share finally skips something. Nothing is dropped or renamed; the
-- redundant place_shares_place_id_idx stays for a later contract step.

-- Remove duplicate shares, blindly: keep the earliest row per
-- (place_id, shared_with_id) (created_at, then id) and delete the rest.
-- The survivor is a full grant on its own, so the recipient keeps the place
-- and the owner keeps the share; nothing else references a place_shares row.
--
-- Each deleted row id is still in two phones' mirrors, because the delta sends
-- a placeShare row to both its sharer and its sharee. So each removed row gets
-- a `placeShare` tombstone for BOTH: shared_by_id (always the place owner,
-- since only the owner can share) and shared_with_id. Unlike a revoke
-- (lib/syncTombstones.ts shareRevokeTombstones) there is NO `place`, `media`
-- or `route` tombstone for the recipient: they still see the place through the
-- survivor, and those would make their phone forget it.
WITH removed AS (
  DELETE FROM "place_shares" AS s
   USING (
     SELECT "id",
            row_number() OVER (
              PARTITION BY "place_id", "shared_with_id"
              ORDER BY "created_at", "id"
            ) AS rn
       FROM "place_shares"
   ) AS ranked
   WHERE s."id" = ranked."id" AND ranked.rn > 1
  RETURNING s."id", s."shared_by_id", s."shared_with_id"
)
INSERT INTO "sync_tombstones" ("user_id", "entity_type", "entity_id")
SELECT u."user_id", 'placeShare', r."id"
  FROM removed AS r
  CROSS JOIN LATERAL (VALUES (r."shared_by_id"), (r."shared_with_id")) AS u("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "place_shares_place_id_shared_with_id_key" ON "place_shares"("place_id", "shared_with_id");

-- CreateIndex
CREATE INDEX "places_place_type_id_idx" ON "places"("place_type_id");

-- CreateIndex
CREATE INDEX "places_forked_from_id_idx" ON "places"("forked_from_id");

-- CreateIndex
CREATE INDEX "place_links_a_place_id_idx" ON "place_links"("a_place_id");
