-- Four SYSTEM field definitions for the ACA canyon rating, scoped to Canyon:
-- technical (1 to 4), water (A, B, C, C1 to C4), time (I to VI), risk (PG, PG13,
-- R, X, XX).
--
-- Each is a whole number, the rank of its letter or numeral: "C2" is stored as 5.
-- The words live in `shared/src/placeTypes.ts` (`labels`), not in the database,
-- so a filter or a sort works on the number. ADR 0051 has the reasoning.
--
-- First, a user's own place field that already holds one of the four keys gets
-- out of the way. `RESERVED_FIELD_KEYS` is derived from the system definitions,
-- so adding one reserves its key after the fact, and nothing in the database stops
-- the two rows coexisting: the unique index is `(owner_id, entity, key)` and theirs
-- is owned while the built-in's is not. Both then claim one slot in `field_values`
-- (the user's value read under the built-in's bounds and labels). The same was
-- done for `has_water` in `20260911130000_resolve_has_water_collisions`. The
-- definition is RENAMED to `<key>_<n>`, never deleted, and its values move first.
--
-- Then the rows are added. The rename and the move of values are the only changes
-- to existing rows, and they happen together in this one migration; the INSERTs
-- touch nothing existing. A client that has not pulled the definitions yet simply
-- does not draw the fields.
--
-- The ids are pinned UUIDv4s in the `a` space that `shared/src/placeTypes.ts`
-- declares; that declaration and these INSERTs are two lists that must agree,
-- and `api/src/lib/systemRowMigration.unit.test.ts` parses this SQL to hold
-- them to it. Positions continue after `has_water`.
--
-- Idempotent, so re-running against a database that already has the rows is
-- not an error.
DO $$
DECLARE
  def RECORD;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR def IN
    SELECT id, owner_id, key, label FROM custom_field_defs
     WHERE entity = 'place' AND owner_id IS NOT NULL
       AND key IN ('aca_technical', 'aca_water', 'aca_time', 'aca_risk')
  LOOP
    suffix := 2;
    LOOP
      candidate := def.key || '_' || suffix;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM custom_field_defs
         WHERE owner_id = def.owner_id AND entity = 'place' AND key = candidate
      );
      suffix := suffix + 1;
    END LOOP;

    RAISE NOTICE 'ACA grades: renaming custom field "%" (key %) to % for owner % — the key is now reserved by a system field',
      def.label, def.key, candidate, def.owner_id;

    -- The VALUES move first: they are keyed by the old key, and once the
    -- definition moves nothing else knows where they were. `updated_at` is set by
    -- hand (Prisma's `@updatedAt` does not fire in SQL): delta sync selects by it,
    -- so a phone that already synced only receives the change if it moves.
    UPDATE places
       SET field_values = jsonb_set(
             field_values,
             ARRAY[candidate],
             field_values -> def.key
           ) - def.key,
           updated_at = CURRENT_TIMESTAMP
     WHERE owner_id = def.owner_id
       AND field_values ? def.key;

    UPDATE custom_field_defs SET key = candidate, updated_at = CURRENT_TIMESTAMP WHERE id = def.id;
  END LOOP;
END $$;

INSERT INTO "custom_field_defs" ("id", "owner_id", "entity", "key", "label", "type", "min", "max", "position", "updated_at") VALUES
  ('a0000000-0000-4000-8000-000000000011', NULL, 'place', 'aca_technical', 'ACA technical', 'integer', 1, 4, 10, CURRENT_TIMESTAMP),
  ('a0000000-0000-4000-8000-000000000012', NULL, 'place', 'aca_water',     'ACA water',     'integer', 1, 7, 11, CURRENT_TIMESTAMP),
  ('a0000000-0000-4000-8000-000000000013', NULL, 'place', 'aca_time',      'ACA time',      'integer', 1, 6, 12, CURRENT_TIMESTAMP),
  ('a0000000-0000-4000-8000-000000000014', NULL, 'place', 'aca_risk',      'ACA risk',      'integer', 1, 5, 13, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "custom_field_def_place_types" ("def_id", "place_type_id") VALUES
  ('a0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000012', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000014', 'b0000000-0000-4000-8000-000000000001')
ON CONFLICT ("def_id", "place_type_id") DO NOTHING;
