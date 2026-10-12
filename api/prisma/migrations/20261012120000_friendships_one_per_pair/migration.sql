-- Two people have ONE friendship row, whichever of them asked. The unique
-- index Prisma declares is on (requester_id, addressee_id), which is
-- directional: it let alice -> bob sit beside bob -> alice when a request and
-- a request (or an invite link) raced past the routes' "either way round"
-- check. This index is on the unordered pair and is the backstop for that
-- race; routes/friends.ts and routes/friendInvites.ts answer its refusal.
--
-- EXPAND-ONLY and safe with the previous API running: it refuses nothing that
-- image meant to write. A race that image used to lose silently, by leaving
-- two rows, now fails its second insert with the unique violation it already
-- gets (and does not catch) for a same-direction race: a 500, with the
-- transaction rolled back and nothing half-written.

-- Held to the end of the migration, so no row slips in between the merge and
-- the index. Reads carry on.
LOCK TABLE "friendships" IN SHARE ROW EXCLUSIVE MODE;

-- Pairs that already have more than one row keep one. THE SURVIVOR: a block
-- beats an accepted row, which beats a pending one; of two with the same
-- status, the older. The survivor is not changed in any way, so a block keeps
-- its direction and a friendship keeps its id and its dates.
CREATE TEMP TABLE "friendship_merge" AS
SELECT r."id" AS loser_id, r."requester_id", r."addressee_id",
       r.survivor_id, r.survivor_status
  FROM (
    SELECT f."id", f."requester_id", f."addressee_id",
           first_value(f."id") OVER pair AS survivor_id,
           first_value(f."status") OVER pair AS survivor_status,
           row_number() OVER pair AS rn
      FROM "friendships" AS f
    WINDOW pair AS (
      PARTITION BY LEAST(f."requester_id", f."addressee_id"),
                   GREATEST(f."requester_id", f."addressee_id")
      ORDER BY CASE f."status" WHEN 'blocked' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
               f."created_at", f."id"
    )
  ) AS r
 WHERE r.rn > 1;

-- Notifications are the only rows that name a friendship id (shares are keyed
-- by the two users). "X accepted your request" stays true of the surviving
-- friendship, so it is repointed there. Everything else naming a row that is
-- going is removed: a request prompt for it could only be answered with an
-- error, and nothing about a pair that ends blocked is kept.
UPDATE "notifications" AS n
   SET "payload" = jsonb_set(n."payload", '{friendshipId}', to_jsonb(m.survivor_id))
  FROM "friendship_merge" AS m
 WHERE n."type" = 'friend_request_accepted'
   AND n."payload"->>'friendshipId' = m.loser_id
   AND m.survivor_status = 'accepted';

DELETE FROM "notifications" AS n
 USING "friendship_merge" AS m
 WHERE n."type" IN ('friend_request', 'friend_request_accepted')
   AND n."payload"->>'friendshipId' = m.loser_id;

-- Friendships are synced: both people's phones hold the row that is going and
-- keep it until told to forget it (lib/syncTombstones.ts).
INSERT INTO "sync_tombstones" ("user_id", "entity_type", "entity_id")
SELECT member.id, 'friendship', m.loser_id
  FROM "friendship_merge" AS m
 CROSS JOIN LATERAL (VALUES (m."requester_id"), (m."addressee_id")) AS member(id);

DELETE FROM "friendships" AS f
 USING "friendship_merge" AS m
 WHERE f."id" = m.loser_id;

DROP TABLE "friendship_merge";

CREATE UNIQUE INDEX "friendships_pair_key"
    ON "friendships" (LEAST("requester_id", "addressee_id"),
                      GREATEST("requester_id", "addressee_id"));
