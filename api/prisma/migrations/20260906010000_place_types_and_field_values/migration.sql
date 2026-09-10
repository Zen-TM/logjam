-- Places rework, phase 1b: place types, scoped field definitions, and the seven
-- grade columns becoming `field_values` keys.
--
-- NOT expand/contract-safe (api/CLAUDE.md), for the same reason phase 1a was
-- not: the deployed image reads `places.v_grade` as a column, and there is no
-- shape both images tolerate. The prod apply is the operator's, with the API
-- stopped.
--
-- WHERE THE OLD `attributes` BLOB GOES — the decision this migration is
-- required to state (plan §4 step 3.2):
--   * `attributes.customFields.<key>`  ->  field_values.<key>        (HOISTED)
--   * `attributes.sources`             ->  field_values._sources
--   * every other attributes key       ->  DROPPED
--
-- The hoist is the whole point and the step that fails SILENTLY if done
-- literally. Canyon custom-field values were stored NESTED, at
-- `attributes.customFields[key]`, while the seven grade columns lift to the TOP
-- level. A flat `attributes || grades` merge would leave user values at
-- `field_values.customFields.<key>` — where the generic renderer, the filter
-- predicate and mergePlace all fail to find them. No error, no warning: every
-- value a user ever typed into a canyon custom field simply disappears.
--
-- `_sources` is a STRUCTURAL reservation, not a convention: `makeCustomFieldKey`
-- collapses non-alphanumeric runs to `_` and then strips a leading and trailing
-- one, so no user-authored key can begin with `_`. Guarded by
-- shared/src/placeTypes.unit.test.ts.
--
-- `sources` is NOT promoted to a real field def: it is [label, url][] and no
-- field type expresses that, and mergePlace has to keep unioning it.
--
-- THE REST IS DROPPED, and that is a decision rather than an oversight. An
-- earlier revision parked it under `_attributes`, a bucket nothing renders:
-- values in the database, invisible in Logjam Web and Logjam GPS, kept against
-- a census of what prod actually held. That census cannot be run safely — the
-- keys ARE user-authored labels, as sensitive as a note under CLAUDE.md's
-- privacy rules, so enumerating them off prod discloses the thing the snapshot
-- scrub exists to protect. Weighed against a beta the owner shipped with no
-- data guarantee, holding unrenderable values cost more than it saved. The
-- known contents were `rockType`/`wetsuit` — dev-seed keys never declared in
-- TPlaceAttributes, which §2.2 declines to promote because it fixes the Canyon
-- type at seven fields. A user who wants either defines a field and types it.

-- ── place types ─────────────────────────────────────────────────────────────
CREATE TABLE "place_types" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT,
    "name" TEXT NOT NULL,
    "icon_key" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "place_types_pkey" PRIMARY KEY ("id")
);

-- NULLS NOT DISTINCT, which Prisma cannot express. Without it Postgres treats
-- every NULL owner_id as distinct, so a re-run or a repeat deploy could insert
-- a SECOND global "Canyon" — and §2.6's copy reconciliation, which matches an
-- incoming type by name, would then resolve to whichever it saw first.
CREATE UNIQUE INDEX "place_types_owner_id_name_key"
    ON "place_types"("owner_id", "name") NULLS NOT DISTINCT;
CREATE INDEX "place_types_owner_id_updated_at_idx" ON "place_types"("owner_id", "updated_at");
ALTER TABLE "place_types" ADD CONSTRAINT "place_types_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The three system types. ownerId NULL = global, one row for every user, which
-- is what makes a shared place resolve for its recipient with no
-- reconciliation. Ids are pinned in shared/src/placeTypes.ts and must stay real
-- UUIDv4s — parsePushOp rejects anything else and would make every place of a
-- system type unsyncable from the phone. placeTypes.unit.test.ts fails if these
-- literals and that file ever disagree.
INSERT INTO "place_types" ("id", "owner_id", "name", "icon_key", "color", "position", "updated_at") VALUES
  ('b0000000-0000-4000-8000-000000000001', NULL, 'Canyon',   'waves',   '#f97316', 0, CURRENT_TIMESTAMP),
  ('b0000000-0000-4000-8000-000000000002', NULL, 'Campsite', 'tent',    '#22c55e', 1, CURRENT_TIMESTAMP),
  ('b0000000-0000-4000-8000-000000000003', NULL, 'Marker',   'map-pin', '#629bf8', 2, CURRENT_TIMESTAMP);

-- ── field definitions: nullable owner, scoping, all-types flag ──────────────
ALTER TABLE "custom_field_defs" ALTER COLUMN "owner_id" DROP NOT NULL;
ALTER TABLE "custom_field_defs" ADD COLUMN "applies_to_all_types" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX "custom_field_defs_owner_id_entity_key_key";
CREATE UNIQUE INDEX "custom_field_defs_owner_id_entity_key_key"
    ON "custom_field_defs"("owner_id", "entity", "key") NULLS NOT DISTINCT;

CREATE TABLE "custom_field_def_place_types" (
    "def_id" TEXT NOT NULL,
    "place_type_id" TEXT NOT NULL,
    CONSTRAINT "custom_field_def_place_types_pkey" PRIMARY KEY ("def_id", "place_type_id")
);
CREATE INDEX "custom_field_def_place_types_place_type_id_idx"
    ON "custom_field_def_place_types"("place_type_id");
ALTER TABLE "custom_field_def_place_types" ADD CONSTRAINT "custom_field_def_place_types_def_id_fkey"
    FOREIGN KEY ("def_id") REFERENCES "custom_field_defs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_field_def_place_types" ADD CONSTRAINT "custom_field_def_place_types_place_type_id_fkey"
    FOREIGN KEY ("place_type_id") REFERENCES "place_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── reserved-key collisions, BEFORE anything writes field_values ────────────
--
-- A user who already has a place custom field labelled "Quality" holds key
-- `quality` at attributes.customFields.quality. The system def about to be
-- inserted claims that key, and so does the lifted `places.quality` column —
-- three writers, one key, in one owner's namespace.
--
-- Resolution: the SYSTEM def wins the reserved key. The user's colliding def is
-- renamed to the first free `<key>_<n>` and its stored values are remapped in
-- the same transaction, so nothing is lost and nothing is overwritten. Every
-- rename is printed. Done here, before the system defs exist, so the unique
-- index can never be the thing that reports the problem.
DO $$
DECLARE
  reserved TEXT[] := ARRAY['v_grade','a_grade','commitment','quality','hours',
                           'num_abseils','longest_abseil','capacity','is_cave'];
  def RECORD;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR def IN
    SELECT id, owner_id, key, label FROM custom_field_defs
     WHERE entity = 'place' AND owner_id IS NOT NULL AND key = ANY(reserved)
  LOOP
    suffix := 2;
    LOOP
      candidate := def.key || '_' || suffix;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM custom_field_defs
         WHERE owner_id = def.owner_id AND entity = 'place' AND key = candidate
      ) AND NOT (candidate = ANY(reserved));
      suffix := suffix + 1;
    END LOOP;

    RAISE NOTICE 'places rework: renaming custom field "%" (key %) to % for owner % — the key is reserved by a system field',
      def.label, def.key, candidate, def.owner_id;

    -- Remap the stored VALUES first: they are still keyed by the old key, and
    -- once the def moves nothing else knows where they were.
    UPDATE places
       SET attributes = jsonb_set(
             attributes,
             ARRAY['customFields', candidate],
             attributes -> 'customFields' -> def.key
           ) #- ARRAY['customFields', def.key]
     WHERE owner_id = def.owner_id
       AND attributes -> 'customFields' ? def.key;

    UPDATE custom_field_defs SET key = candidate WHERE id = def.id;
  END LOOP;
END $$;

-- The system field definitions and their type scopings. Bounds are lifted
-- verbatim from PLACE_NUMERIC_CONSTRAINTS, so nothing storable before is
-- invalid now — including the min-only ones, which is why one-sided bounds had
-- to become legal.
INSERT INTO "custom_field_defs" ("id", "owner_id", "entity", "key", "label", "type", "min", "max", "position", "updated_at") VALUES
  ('a0000000-0000-4000-8000-000000000001', NULL, 'place', 'v_grade',        'V grade',       'integer', 1,    7,    0, CURRENT_TIMESTAMP),
  ('a0000000-0000-4000-8000-000000000002', NULL, 'place', 'a_grade',        'A grade',       'integer', 1,    7,    1, CURRENT_TIMESTAMP),
  ('a0000000-0000-4000-8000-000000000003', NULL, 'place', 'commitment',     'Commitment',    'integer', 1,    6,    2, CURRENT_TIMESTAMP),
  ('a0000000-0000-4000-8000-000000000004', NULL, 'place', 'quality',        'Quality',       'float',   1,    5,    3, CURRENT_TIMESTAMP),
  ('a0000000-0000-4000-8000-000000000005', NULL, 'place', 'hours',          'Hours',         'float',   0,    NULL, 4, CURRENT_TIMESTAMP),
  ('a0000000-0000-4000-8000-000000000006', NULL, 'place', 'num_abseils',    'Pitches',       'integer', 0,    NULL, 5, CURRENT_TIMESTAMP),
  ('a0000000-0000-4000-8000-000000000007', NULL, 'place', 'longest_abseil', 'Longest pitch', 'float',   0,    NULL, 6, CURRENT_TIMESTAMP),
  ('a0000000-0000-4000-8000-000000000008', NULL, 'place', 'capacity',       'Capacity',      'integer', 0,    NULL, 7, CURRENT_TIMESTAMP),
  ('a0000000-0000-4000-8000-000000000009', NULL, 'place', 'is_cave',        'Is a cave?',    'boolean', NULL, NULL, 8, CURRENT_TIMESTAMP);

-- `quality` is ONE def scoped to BOTH Canyon and Campsite, not two defs.
INSERT INTO "custom_field_def_place_types" ("def_id", "place_type_id") VALUES
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000002');

-- Every existing user place def belonged to canyons, so it scopes to Canyon and
-- not to all types. `appliesToAllTypes` stays false, which the column default
-- already gives.
INSERT INTO "custom_field_def_place_types" ("def_id", "place_type_id")
SELECT id, 'b0000000-0000-4000-8000-000000000001'
  FROM custom_field_defs
 WHERE entity = 'place' AND owner_id IS NOT NULL;

-- ── places: type, field_values, foreign_fields ──────────────────────────────
ALTER TABLE "places" ADD COLUMN "place_type_id" TEXT;
ALTER TABLE "places" ADD COLUMN "field_values" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "places" ADD COLUMN "foreign_fields" JSONB;

-- Everything that exists today is a canyon.
UPDATE "places" SET "place_type_id" = 'b0000000-0000-4000-8000-000000000001';

-- THE HOIST. Built key by key so the nesting cannot be preserved by accident:
--   1. the customFields sub-object, promoted to the top level
--   2. the seven grade columns, at the top level beside them, NULLs omitted
--      (a stored null is not "no value" — it would render as an empty field
--      and satisfy a "has a value" filter)
--   3. sources under _sources, in the reserved underscore namespace; every
--      other attributes key dropped (see the header)
UPDATE "places" SET "field_values" =
    COALESCE("attributes" -> 'customFields', '{}'::jsonb)
 || (CASE WHEN "v_grade"          IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('v_grade', "v_grade") END)
 || (CASE WHEN "a_grade"          IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('a_grade', "a_grade") END)
 || (CASE WHEN "commitment"       IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('commitment', "commitment") END)
 || (CASE WHEN "quality"          IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('quality', "quality") END)
 || (CASE WHEN "hours"            IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('hours', "hours") END)
 || (CASE WHEN "num_abseils"      IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('num_abseils', "num_abseils") END)
 || (CASE WHEN "longest_abseil_m" IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('longest_abseil', "longest_abseil_m") END)
 || (CASE WHEN "attributes" -> 'sources' IS NULL THEN '{}'::jsonb
          ELSE jsonb_build_object('_sources', "attributes" -> 'sources') END);

-- Fail LOUDLY rather than leaving a place without a type. The FK below would
-- report this as a constraint violation naming a column; this names the fault.
DO $$
DECLARE orphans INT;
BEGIN
  SELECT count(*) INTO orphans FROM places WHERE place_type_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'places rework: % place(s) ended up with no type', orphans;
  END IF;
END $$;

ALTER TABLE "places" ALTER COLUMN "place_type_id" SET NOT NULL;
ALTER TABLE "places" ADD CONSTRAINT "places_place_type_id_fkey"
    FOREIGN KEY ("place_type_id") REFERENCES "place_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "places" DROP COLUMN "v_grade";
ALTER TABLE "places" DROP COLUMN "a_grade";
ALTER TABLE "places" DROP COLUMN "commitment";
ALTER TABLE "places" DROP COLUMN "quality";
ALTER TABLE "places" DROP COLUMN "hours";
ALTER TABLE "places" DROP COLUMN "num_abseils";
ALTER TABLE "places" DROP COLUMN "longest_abseil_m";
ALTER TABLE "places" DROP COLUMN "attributes";

-- The import key is matched WITHIN a type from here on, so the constraint has
-- to be too: placeImportKey() derives from name + rounded coords with no type
-- input, and a type-blind constraint would 409 a Marker CSV row that shares a
-- name and position with a canyon.
DROP INDEX "places_owner_id_import_key_key";
CREATE UNIQUE INDEX "places_owner_id_place_type_id_import_key_key"
    ON "places"("owner_id", "place_type_id", "import_key");
CREATE INDEX "places_owner_id_place_type_id_idx" ON "places"("owner_id", "place_type_id");

-- ── stored merge policies ───────────────────────────────────────────────────
-- Import merge policies are keyed by MERGEABLE_FIELD, which was camelCase
-- column names and is now field KEYS. An unmigrated policy does not error — it
-- silently falls back to the default for every field the user had configured.
UPDATE "users"
   SET "ui_preferences" = jsonb_set(
         "ui_preferences",
         '{importMergePolicy}',
         (
           SELECT jsonb_object_agg(
                    CASE key
                      WHEN 'vGrade'        THEN 'v_grade'
                      WHEN 'aGrade'        THEN 'a_grade'
                      WHEN 'numAbseils'    THEN 'num_abseils'
                      WHEN 'longestAbseil' THEN 'longest_abseil'
                      ELSE key
                    END,
                    value
                  )
             FROM jsonb_each("ui_preferences" -> 'importMergePolicy')
         )
       )
 WHERE "ui_preferences" -> 'importMergePolicy' IS NOT NULL
   AND jsonb_typeof("ui_preferences" -> 'importMergePolicy') = 'object'
   AND "ui_preferences" -> 'importMergePolicy' <> '{}'::jsonb;

-- ── sync vocabulary ─────────────────────────────────────────────────────────
-- placeType joins SYNC_ENTITY_TYPES and every place row changes shape without
-- its updatedAt moving, so no cursor from before this point can be resumed.
DELETE FROM "sync_tombstones";
