# 0011. Place types and system rows

- **Date:** 2026-09-06
- **Status:** Accepted
- **Supersedes:** —

## Context

`Canyon` and `Waypoint` used to be two entities with two forms before the 2026-09-06 rework.

A system type's `ownerId` is NULL and Postgres sorts NULLS LAST on a plain `ASC`, so `GET /place-types` returned the built-ins at the BOTTOM while its own docstring promised the opposite — both clients build their leftmost tab and their default type from this order.

Free-text icons and colours fail cross-platform and accessibility guarantees: an icon key resolves in one client's icon set and not the other's (mobile draws Feather, web draws lucide), while a free hex picker would delete the WCAG 3:1 contrast guarantee.

On the sync wire, `ownerId: isString` on the definition spec dropped all nine field definitions off every page a phone pulled, so grades arrived on places with no definition to label or bound them and `defsForType` answered "no fields" for a canyon. Every parser test on both sides built its rows by hand and saw nothing.

Colour on the map used to encode ownership and cannot any more, because it now says which kind of place this is.

## Decision

A place has a TYPE, and the type owns the form, the colour and the icon. `Canyon` and `Waypoint` are one `Place` (2026-09-06 rework); what used to be two entities with two forms is one entity whose `PlaceType` says which questions it asks.

Three SYSTEM types (Canyon, Campsite, Marker) are GLOBAL rows with pinned ids and `ownerId = null` — one row shared by every account, which is what lets a shared or copied place of a system type resolve for its recipient with no reconciliation at all — and a user may add their own. `SYSTEM_PLACE_TYPES` in `shared/src/placeTypes.ts` is the declaration; the seed reads it rather than restating it, and the ids are pinned UUIDv4s (`api/src/lib/seedIds.unit.test.ts`).

- **A system type is undeletable and unrenameable, and the API answers 404 rather than 403** — the same anti-oracle every id-addressed surface uses. RopeWiki import writes reserved field keys into the Canyon type, so a deletable Canyon type would let import write values nothing can render. Guard: `api/src/__tests__/placeTypes.test.ts`.
- **System types sort FIRST, and that needs saying out loud in SQL.** `orderBy: [{ ownerId: { sort: "asc", nulls: "first" } }, …]`; guard: `placeTypes.test.ts`, "returns the system types before the caller's own". SQLite sorts NULLs FIRST by default, so the phone's mirror query spells the same order explicitly rather than relying on either engine (`listMirrorPlaceTypes`).
- **Icon and colour come from CURATED lists** (`PLACE_TYPE_ICON_KEYS`, `PLACE_TYPE_COLORS`), not free text, for two hard reasons: an icon key resolves in one client's icon set and not the other's (mobile draws Feather, web draws lucide — guards: `mobile/src/places/placeTypeIcons.test.ts`, `frontend/src/placeTypeIcons.test.ts`, one per side of the same list), and a map marker colour has a WCAG 3:1 guarantee that can only be asserted over a closed set (`scripts/wcag-contrast.mjs` checks every palette entry under every theme scheme). A free hex picker would not fail that check — it would DELETE it.
- **On the map, FILL is the type and the RING is sharing.** Colour used to encode ownership and cannot any more, because it now says which kind of place this is. See `mobile/src/map/PlacePinsLayer.tsx`.
- **A SYSTEM row belongs to no account, on the wire as well as in the database.** Both kinds — the three place types and the nine field definitions — carry `ownerId: null`, and the delta row spec must say so: `ownerId: isString` on the definition spec dropped all nine off every page a phone pulled, so grades arrived on places with no definition to label or bound them and `defsForType` answered "no fields" for a canyon. Every parser test on both sides built its rows by hand and saw nothing. Ground truth lives in `api/src/__tests__/syncBoundary.test.ts`, which parses what the LIVE server sends through the shared specs — the guard for this whole class, not just this field.

## Consequences

- **Positive:** shared or copied place of a system type resolves for its recipient with no reconciliation at all; unified `Place` data model; cross-platform icon rendering and WCAG 3:1 contrast are preserved.
- **Negative:** Not recorded.
- **Neutral:** on the map, colour no longer encodes ownership (FILL is the type and the RING is sharing).

## Alternatives considered

- Deletable or renameable system types: rejected; RopeWiki import writes reserved field keys into the Canyon type, so a deletable Canyon type would let import write values nothing can render.
- Returning 403 for system type modifications: rejected; API answers 404 rather than 403 as an anti-oracle.
- Plain `ASC` sort in SQL: rejected; Postgres sorts NULLS LAST on plain `ASC`, returning built-in system types at the bottom.
- Free-text icon keys and hex colour pickers: rejected; free text breaks cross-platform rendering (Feather vs lucide) and deletes the WCAG 3:1 contrast guarantee.
- Wire delta row spec with `ownerId: isString`: rejected; dropped all nine system definitions because system rows carry `ownerId: null`.
