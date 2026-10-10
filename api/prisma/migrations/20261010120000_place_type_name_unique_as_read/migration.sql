-- A user's place type names are unique AS A PERSON READS THEM: trimmed, runs
-- of spaces collapsed, case ignored. The expression below is `nameKey` in
-- shared/src/placeTypes.ts, which the API and both clients already check
-- with; this index is the backstop for two writes racing past that check.
--
-- The exact index on (owner_id, name) stays: Prisma's schema declares it, and
-- it is what keeps the built-ins (owner_id NULL) from being inserted twice.
-- This one cannot stop a user's own "canyon" beside the built-in Canyon,
-- because the two rows have different owners; the API holds that half.
--
-- EXPAND-ONLY and safe with the previous API running: it refuses nothing that
-- image should have written, and a duplicate it does try to write gets the
-- same unique violation the exact index already gave it.

-- Rows from before the rule. The earliest of each set keeps its name, and so
-- does a built-in; every later one takes the next free "name (2)", which is
-- what a sync push does with a taken name (`freePlaceTypeName`). Nothing is
-- merged or deleted: a type's places stay on it. `updated_at` is bumped so the
-- delta pull carries the new name to phones already past this cursor.
DO $$
DECLARE
  r RECORD;
  n INT;
  suffix TEXT;
  candidate TEXT;
BEGIN
  FOR r IN
    SELECT d."id", d."owner_id", d."name"
      FROM (
        SELECT t."id", t."owner_id", t."name", t."created_at",
               row_number() OVER (
                 PARTITION BY t."owner_id",
                              lower(btrim(regexp_replace(t."name", '\s+', ' ', 'g')))
                 ORDER BY t."created_at", t."id"
               ) AS rn,
               EXISTS (
                 SELECT 1 FROM "place_types" AS s
                  WHERE s."owner_id" IS NULL
                    AND lower(btrim(regexp_replace(s."name", '\s+', ' ', 'g')))
                      = lower(btrim(regexp_replace(t."name", '\s+', ' ', 'g')))
               ) AS shadows_built_in
          FROM "place_types" AS t
         WHERE t."owner_id" IS NOT NULL
      ) AS d
     WHERE d.rn > 1 OR d.shadows_built_in
     ORDER BY d."created_at", d."id"
  LOOP
    n := 2;
    LOOP
      suffix := format(' (%s)', n);
      -- 60 is PLACE_TYPE_NAME_MAX_LENGTH.
      candidate := rtrim(left(btrim(r."name"), 60 - length(suffix))) || suffix;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "place_types" AS o
         WHERE (o."owner_id" = r."owner_id" OR o."owner_id" IS NULL)
           AND lower(btrim(regexp_replace(o."name", '\s+', ' ', 'g')))
             = lower(btrim(regexp_replace(candidate, '\s+', ' ', 'g')))
      );
      n := n + 1;
    END LOOP;
    UPDATE "place_types"
       SET "name" = candidate, "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = r."id";
  END LOOP;
END $$;

CREATE UNIQUE INDEX "place_types_owner_id_name_as_read_key"
    ON "place_types" ("owner_id", lower(btrim(regexp_replace("name", '\s+', ' ', 'g'))));
