-- Get out of the way of anyone who already had "has_water" as their own field.
--
-- `RESERVED_FIELD_KEYS` is DERIVED from the system definitions, so adding one
-- makes its key reserved AFTER the fact: a user who defined "Has a water
-- source?" yesterday now holds a definition the rules say they may not have.
-- Nothing at the database level stops the two rows coexisting — the unique
-- index is `(owner_id, entity, key)`, and theirs is owned while the built-in's
-- is not. What breaks is everything that assumes a key identifies ONE
-- definition, starting with the mobile field list, which rendered both under
-- one React key and dropped a row ("Encountered two children with the same
-- key, `has_water`").
--
-- ADDING A SYSTEM FIELD DEFINITION ALWAYS NEEDS THIS, and it is the general
-- lesson rather than a detail of this one: `20260906010000` had to do exactly
-- the same for the first nine, and the next one will too.
--
-- Its own migration rather than part of `20260911120000`, which has already
-- been applied — Prisma checksums an applied migration, and editing one forces
-- `migrate reset` on every dev database that has seen it. The two run in the
-- same `migrate deploy`, so the window where both rows exist is not observable.
--
-- The user's definition is RENAMED, never deleted, and its stored values move
-- with it: they keep their field under a suffixed key, beside the new built-in.
DO $$
DECLARE
  def RECORD;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR def IN
    SELECT id, owner_id, key, label FROM custom_field_defs
     WHERE entity = 'place' AND owner_id IS NOT NULL AND key = 'has_water'
  LOOP
    suffix := 2;
    LOOP
      candidate := 'has_water_' || suffix;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM custom_field_defs
         WHERE owner_id = def.owner_id AND entity = 'place' AND key = candidate
      );
      suffix := suffix + 1;
    END LOOP;

    RAISE NOTICE 'campsite water source: renaming custom field "%" (key %) to % for owner % — the key is now reserved by a system field',
      def.label, def.key, candidate, def.owner_id;

    -- The VALUES move first: they are keyed by the old key, and once the
    -- definition moves nothing else knows where they were. Top level of
    -- `field_values` — the `attributes.customFields` nesting is long gone.
    UPDATE places
       SET field_values = jsonb_set(
             field_values,
             ARRAY[candidate],
             field_values -> def.key
           ) - def.key
     WHERE owner_id = def.owner_id
       AND field_values ? def.key;

    UPDATE custom_field_defs SET key = candidate WHERE id = def.id;
  END LOOP;
END $$;
