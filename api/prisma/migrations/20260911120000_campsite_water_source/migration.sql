-- A tenth SYSTEM field definition: "Has a water source?" on Campsite.
--
-- Water is the thing that decides whether a campsite is usable, so it earns a
-- built-in rather than waiting for every user to define it themselves — the
-- same argument `is_cave` already won.
--
-- Written as its own migration rather than by editing `20260906010000`, which
-- has been applied: Prisma checksums an applied migration, and changing one
-- forces `migrate reset` on every dev database that has seen it.
--
-- EXPAND-ONLY, so it is safe to apply with the API running: it adds a row and a
-- scoping link and touches nothing existing. A client that has not pulled the
-- definition yet simply does not draw the field.
--
-- The id is a pinned UUIDv4 in the `a` space (system field definitions), which
-- `shared/src/placeTypes.ts` declares and `api/src/lib/seedIds.unit.test.ts`
-- keeps from colliding with the seed's own id spaces. That declaration and this
-- INSERT are two lists that must agree; the guard that fails when they drift is
-- `api/src/lib/systemRowMigration.unit.test.ts`, which parses this SQL.
--
-- Idempotent, so re-running against a database that already has the row (a
-- restored snapshot, a re-applied branch) is not an error.
INSERT INTO "custom_field_defs" ("id", "owner_id", "entity", "key", "label", "type", "min", "max", "position", "updated_at") VALUES
  ('a0000000-0000-4000-8000-000000000010', NULL, 'place', 'has_water',      'Has a water source?', 'boolean', NULL, NULL, 9, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Scoped to Campsite only. A canyon does not get asked.
INSERT INTO "custom_field_def_place_types" ("def_id", "place_type_id") VALUES
  ('a0000000-0000-4000-8000-000000000010', 'b0000000-0000-4000-8000-000000000002')
ON CONFLICT ("def_id", "place_type_id") DO NOTHING;
