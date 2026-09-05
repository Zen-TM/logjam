-- Promote custom field DEFINITIONS out of `users.ui_preferences` into rows.
--
-- Two reasons, both structural:
--  1. A definition has to be editable offline and reconciled by the sync
--     engine. The engine works on rows with an id, an updated_at and a
--     tombstone — a JSON array on the user row has none of those, and its only
--     possible merge is whole-list last-writer-wins.
--  2. A definition has to be readable by someone who is not its owner. Values
--     keyed by these definitions already travel to share recipients inside
--     `canyons.attributes -> 'customFields'`, and a private per-user
--     preferences blob can never accompany them — so a copied shared canyon
--     lands carrying values nothing can name.
--
-- The VALUES are untouched by this migration. They stay keyed by `key` on
-- `trip_logs.custom_fields` and `canyons.attributes -> 'customFields'`.

CREATE TABLE "custom_field_defs" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    -- "tripLog" | "canyon".
    "entity" TEXT NOT NULL,
    -- The slug the stored values are keyed by. Stable across a rename.
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    -- string | integer | float | date | boolean.
    "type" TEXT NOT NULL,
    -- Inclusive bounds for numeric fields; both or neither.
    "min" DOUBLE PRECISION,
    "max" DOUBLE PRECISION,
    -- Carried by array index before this table existed.
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_defs_pkey" PRIMARY KEY ("id")
);

-- The uniqueness `buildCustomFieldDef` enforced in application code only.
CREATE UNIQUE INDEX "custom_field_defs_owner_id_entity_key_key"
    ON "custom_field_defs"("owner_id", "entity", "key");

-- Delta sync pages by (updated_at, id) within one owner.
CREATE INDEX "custom_field_defs_owner_id_updated_at_idx"
    ON "custom_field_defs"("owner_id", "updated_at");

ALTER TABLE "custom_field_defs"
    ADD CONSTRAINT "custom_field_defs_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- Mirrors `normalizeCustomFieldDefs` (shared/src/themeSchemes.ts) on the two
-- rules that decide whether a definition survives, so nothing a user can
-- currently see is lost:
--   * legacy `type: "text"` is repaired to "string" (repairLegacyFieldType);
--   * anything still failing `isTripLogCustomFieldDef` is DROPPED rather than
--     aborting the migration — the app has been dropping those on every read
--     for as long as the guard has existed, so they are already invisible and
--     unusable. Failing loudly here would block the deploy on data no user can
--     see.
-- Verified against the real function over a fixture carrying every malformed
-- shape (missing label, empty key, unknown type, half-bounds, min >= max,
-- fractional bounds on an integer, bounds on a string, a non-object element):
-- both keep exactly the same definitions.
--
-- Array index becomes `position`, so the order the user arranged is preserved.
--
-- ONE deliberate divergence: the array permitted two definitions with the same
-- key and the guard passed both through; the table's unique index does not, so
-- the FIRST occurrence wins. That is the one the app's own find-by-key already
-- resolved to, and both shared a single storage slot in the values (they are
-- keyed by `key`), so only the loser's label and type go — no user-entered
-- value is affected.

WITH candidate AS (
    SELECT
        u.id AS owner_id,
        src.entity,
        elem->>'key'   AS key,
        elem->>'label' AS label,
        -- repairLegacyFieldType
        CASE WHEN elem->>'type' = 'text' THEN 'string' ELSE elem->>'type' END AS type,
        CASE WHEN jsonb_typeof(elem->'min') = 'number'
             THEN (elem->>'min')::double precision END AS min,
        CASE WHEN jsonb_typeof(elem->'max') = 'number'
             THEN (elem->>'max')::double precision END AS max,
        (ord - 1)::int AS position
    FROM "users" u
    CROSS JOIN LATERAL (
        VALUES ('tripLog', 'tripLogCustomFields'),
               ('canyon',  'canyonCustomFields')
    ) AS src(entity, prefs_key)
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE
            WHEN jsonb_typeof(u.ui_preferences -> src.prefs_key) = 'array'
            THEN u.ui_preferences -> src.prefs_key
            ELSE '[]'::jsonb
        END
    ) WITH ORDINALITY AS t(elem, ord)
    WHERE jsonb_typeof(elem) = 'object'
),
valid AS (
    SELECT * FROM candidate
    WHERE key IS NOT NULL AND key <> ''
      AND label IS NOT NULL AND label <> ''
      AND type IN ('string', 'integer', 'float', 'date', 'boolean')
      -- Bounds are optional, but present-together, numeric-only, min < max,
      -- and whole numbers on an integer field. Same rules as the guard; a def
      -- that breaks them is dropped, not silently de-bounded.
      AND (min IS NULL) = (max IS NULL)
      AND (min IS NULL OR (
              type IN ('integer', 'float')
          AND min < max
          AND (type <> 'integer' OR (min = trunc(min) AND max = trunc(max)))
      ))
)
INSERT INTO "custom_field_defs"
    (id, owner_id, entity, key, label, type, min, max, position, created_at, updated_at)
SELECT DISTINCT ON (owner_id, entity, key)
    gen_random_uuid()::text,
    owner_id, entity, key, label, type, min, max, position,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM valid
ORDER BY owner_id, entity, key, position;

-- The `tripLogCustomFields` / `canyonCustomFields` keys are deliberately LEFT
-- in `users.ui_preferences`. Nothing reads them from this deploy on — the API
-- projects both keys onto the /users/me response from this table instead — so
-- they are inert, and keeping them means a botched backfill can be re-run
-- rather than restored from a snapshot. Drop them in a follow-up contract
-- migration once this has been live long enough to trust.
