-- Deletes the share notifications whose share is gone: exactly the rows
-- GET /notifications already hides (routes/notifications.ts), which still
-- counted in the unread badge with no way to open them. Older code revoked
-- place shares without purging, and some of those rows hold a place name.
--
-- EXPAND-ONLY: the old image never reads a notification whose share is gone,
-- and a share made while this runs keeps its notification, which only counts
-- as an orphan once its share row is gone.

DELETE FROM "notifications" AS n
 WHERE n."type" = 'place_shared'
   AND NOT EXISTS (
     SELECT 1 FROM "place_shares" AS s
      WHERE s."place_id" = n."payload" ->> 'placeId'
        AND s."shared_with_id" = n."user_id");

DELETE FROM "notifications" AS n
 WHERE n."type" = 'item_shared'
   AND NOT EXISTS (
     SELECT 1 FROM "shares" AS s
      WHERE s."entity_type" = n."payload" ->> 'entityType'
        AND s."entity_id" = n."payload" ->> 'entityId'
        AND s."shared_with_id" = n."user_id");
