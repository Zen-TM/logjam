-- The system place types were inserted with icon keys that exist on NEITHER
-- client.
--
-- `20260906010000` wrote 'waves' for Canyon and 'tent' for Campsite. Both are
-- lucide-only names — `mobile/src/places/placeTypeIcons.test.ts` names those two
-- literally as the trap ("`waves` and `tent` are lucide-only, and both were the
-- first choice here") — and neither is in `PLACE_TYPE_ICON_KEYS`, the curated
-- cross-platform list. `SYSTEM_PLACE_TYPES` in shared/src/placeTypes.ts declares
-- 'droplet' and 'triangle'.
--
-- Nothing crashed, which is why it survived: both clients fall back to a pin for
-- an unknown key. The cost is that a database built by MIGRATION disagreed with
-- one built by the SEED, and every canyon in prod would have drawn the generic
-- marker.
--
-- A CORRECTIVE MIGRATION rather than an edit to the committed one: that file has
-- been applied to dev databases, and Prisma refuses a migration whose checksum
-- moved after it ran.
--
-- Scoped to the system rows (`owner_id IS NULL`) and to the exact wrong values,
-- so it cannot touch a type a user has since edited.
UPDATE "place_types"
   SET "icon_key" = 'droplet'
 WHERE "id" = 'b0000000-0000-4000-8000-000000000001'
   AND "owner_id" IS NULL
   AND "icon_key" = 'waves';

UPDATE "place_types"
   SET "icon_key" = 'triangle'
 WHERE "id" = 'b0000000-0000-4000-8000-000000000002'
   AND "owner_id" IS NULL
   AND "icon_key" = 'tent';

-- The colours moved with the icons, and for a harder reason than taste: the
-- first palette was a Tailwind ramp whose mid-tone hues carry no legible label
-- when a chip fills itself with one (ten of twelve failed WCAG AA), and the
-- blue it gave Marker was the same blue the map draws a SHARED pin's ring in —
-- so a shared marker was a blue dot inside a blue ring. See
-- `shared/src/placeTypes.ts`; `scripts/wcag-contrast.mjs` checks both pairs.
UPDATE "place_types"
   SET "color" = '#E4C5AA'
 WHERE "id" = 'b0000000-0000-4000-8000-000000000001'
   AND "owner_id" IS NULL
   AND lower("color") = '#f97316';

UPDATE "place_types"
   SET "color" = '#BED9B5'
 WHERE "id" = 'b0000000-0000-4000-8000-000000000002'
   AND "owner_id" IS NULL
   AND lower("color") = '#22c55e';

UPDATE "place_types"
   SET "color" = '#B7D0E1'
 WHERE "id" = 'b0000000-0000-4000-8000-000000000003'
   AND "owner_id" IS NULL
   AND lower("color") = '#629bf8';
