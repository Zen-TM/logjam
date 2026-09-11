-- A definition that names no place types must be on EVERY form, not none.
--
-- `20260906010000` added `applies_to_all_types` with a DEFAULT of false and
-- backfilled the scoping for `entity = 'place'` rows only ("every existing user
-- place def belonged to canyons"). Trip-log definitions were left with the flag
-- off and no join rows — a state both readers (`defsForType`, `tripFieldDefs`)
-- answer with "this field belongs to no form". The definition still lists in
-- Settings, so it reads as the trip form having lost its attributes rather than
-- as a scoping fault. Every trip-log definition in existence was affected;
-- found on the owner's phone (three fields, all invisible), not by a test.
--
-- The same state is possible for a place definition written by a caller that
-- predates the scoping, so the backfill is expressed over the CONDITION rather
-- than over `entity = 'tripLog'`: flag off, and no rows in the join table.
-- Nothing else can be meant by it.
--
-- Going forward `createFieldDef` defaults the flag to "on when no types were
-- named" (api/src/lib/customFieldDefs.ts), so this is a one-time repair of rows
-- that already exist rather than a rule this migration has to keep.
--
-- EXPAND-ONLY and safe with the API running: it widens where a definition
-- applies and never narrows it, and a client that has not pulled the change yet
-- simply keeps not drawing the field.
UPDATE "custom_field_defs" AS d
   SET "applies_to_all_types" = true,
       -- Bumped so the delta pull carries the repaired row to clients that are
       -- already past this cursor.
       "updated_at" = CURRENT_TIMESTAMP
 WHERE d."applies_to_all_types" = false
   AND NOT EXISTS (
     SELECT 1 FROM "custom_field_def_place_types" AS j WHERE j."def_id" = d."id"
   );
