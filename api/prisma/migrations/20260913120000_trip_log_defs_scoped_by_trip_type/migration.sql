-- A TRIP attribute is scoped by the trip's own TYPES (its tags), not by the
-- types of the places it links.
--
-- The places rework scoped trip definitions through `custom_field_def_place_types`
-- (plan §2.7), but no client ever offered that choice, so every trip definition
-- ended up `applies_to_all_types` (20260911140000). Tags are the better axis: a
-- trip is often logged with no place at all, and the tags are what say what the
-- user was doing. `trip_types` holds them; the place-type scoping on a trip
-- definition is retired.
--
-- EXPAND-ONLY and safe with the API running: a new column with a default, and
-- a repair that only ever WIDENS where a definition appears.

ALTER TABLE "custom_field_defs"
  ADD COLUMN "trip_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- A trip definition that was scoped to place types and nothing else would be on
-- NO form once those rows go — every reader asks "all, or one of these tags?".
-- Put it on every form instead, the same repair 20260911140000 made. Bumped so
-- the delta pull carries the change to clients already past this cursor.
UPDATE "custom_field_defs" AS d
   SET "applies_to_all_types" = true,
       "updated_at" = CURRENT_TIMESTAMP
 WHERE d."entity" = 'tripLog'
   AND d."applies_to_all_types" = false
   AND EXISTS (
     SELECT 1 FROM "custom_field_def_place_types" AS j WHERE j."def_id" = d."id"
   );

DELETE FROM "custom_field_def_place_types" AS j
 USING "custom_field_defs" AS d
 WHERE j."def_id" = d."id"
   AND d."entity" = 'tripLog';
