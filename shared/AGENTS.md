# Shared — `@logjam/shared`

Pure TypeScript that `api`, `frontend` and `mobile` all import: the
declarations both clients build from and the logic they must compute alike.
Before writing that logic in a client, look for it in `src/`.

- **No React, Prisma, or Node- or DOM-only APIs:** it runs in all three.
- **Consumers import `shared/dist/`, not `src/`:** after editing, `make shared`
  (or `npm run build` here) before `api`, `frontend` or Metro see the change.
- **Tests:** `npm test` (vitest), colocated `*.test.ts`; canned inputs in
  `src/__fixtures__/`.

## One source each

- **A place's `PlaceType` owns its form, colour and icon.** System types come
  from `SYSTEM_PLACE_TYPES` (`src/placeTypes.ts`) with pinned ids and
  `ownerId = null`; icons and colours only from `PLACE_TYPE_ICON_KEYS` /
  `PLACE_TYPE_COLORS`. On the map, fill is the type, the ring is sharing. [0011](../docs/decisions/0011-place-types-and-system-rows.md)
- **Custom field definitions are scoped rows, and one rule builds every
  form:** place forms from `defsForType`, trip forms from `tripFieldDefs`
  (`src/tripLogFields.ts`); read a grade with `numericFieldValue` / `fieldValue`,
  never a column. `RESERVED_FIELD_KEYS` (may a user take this key) is not
  `CANYON_FORM_FIELD_KEYS` (has a bespoke control). A form writes only the
  fields it showed. [0012](../docs/decisions/0012-custom-field-definitions.md)
- **A total needs a declaration:** no aggregate sums a user field; show an
  average and a highest until a definition says it accumulates
  (`src/logbookStats.ts`). [0013](../docs/decisions/0013-totals-need-a-declaration.md)
- **A trip's title is derived, never stored:** `displayName ?? formatTripPlaceNames(...)`
  (`src/tripName.ts`) `?? "Untitled trip"`. `displayName` stays null until the
  user edits it, except where a place delete backfills it on trips that lose
  their last linked place.
- **Topo export legality** is `reconcileExportSelection` / `validateExportRequest`
  (`src/topoExport.ts`); every export surface calls them.
