-- Four SYSTEM field definitions for the ACA canyon rating, scoped to Canyon:
-- technical (1 to 4), water (A, B, C, C1 to C4), time (I to VI), risk (R, X, XX).
--
-- Each is a whole number, the rank of its letter or numeral: "C2" is stored as 5.
-- The words live in `shared/src/placeTypes.ts` (`labels`), not in the database,
-- so a filter or a sort works on the number. ADR 0051 has the reasoning.
--
-- EXPAND-ONLY, so it is safe to apply with the API running: it adds rows and
-- scoping links and touches nothing existing (ADR 0003). A client that has not
-- pulled the definitions yet simply does not draw the fields.
--
-- The ids are pinned UUIDv4s in the `a` space that `shared/src/placeTypes.ts`
-- declares; that declaration and these INSERTs are two lists that must agree,
-- and `api/src/lib/systemRowMigration.unit.test.ts` parses this SQL to hold
-- them to it. Positions continue after `has_water`.
--
-- Idempotent, so re-running against a database that already has the rows is
-- not an error.
INSERT INTO "custom_field_defs" ("id", "owner_id", "entity", "key", "label", "type", "min", "max", "position", "updated_at") VALUES
  ('a0000000-0000-4000-8000-000000000011', NULL, 'place', 'aca_technical', 'ACA technical', 'integer', 1, 4, 10, CURRENT_TIMESTAMP),
  ('a0000000-0000-4000-8000-000000000012', NULL, 'place', 'aca_water',     'ACA water',     'integer', 1, 7, 11, CURRENT_TIMESTAMP),
  ('a0000000-0000-4000-8000-000000000013', NULL, 'place', 'aca_time',      'ACA time',      'integer', 1, 6, 12, CURRENT_TIMESTAMP),
  ('a0000000-0000-4000-8000-000000000014', NULL, 'place', 'aca_risk',      'ACA risk',      'integer', 1, 3, 13, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "custom_field_def_place_types" ("def_id", "place_type_id") VALUES
  ('a0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000012', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000014', 'b0000000-0000-4000-8000-000000000001')
ON CONFLICT ("def_id", "place_type_id") DO NOTHING;
