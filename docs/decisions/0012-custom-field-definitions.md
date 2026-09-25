# 0012. Custom field definitions

- **Date:** 2026-09-13
- **Status:** Accepted
- **Supersedes:** —

## Context

Custom field definitions originally lived as an array on `User.uiPreferences`.

Earlier scoping models had severe failure modes:
- Join rows for "all types" silently failed to apply to a type created tomorrow, hiding fields from users who ticked "All".
- Using `RESERVED_FIELD_KEYS` ("may a user take this key", which covers every system definition including campsite's `capacity` and `is a cave?`) to filter generic field lists caused both clients to cut those fields out on the assumption that canyon UI renders them, silently removing them from create forms and filter sheets.
- Trip forms used to be scoped by the types of places the trip links (changed 2026-09-13). A trip is often logged with no place at all, and its tags say what the user was doing. Furthermore, the canyoning tag was force-added for any linked place, tagging a night at a campsite.
- Saving forms by iterating every definition wrote a null for fields scoped to other types, and a null removes the key. Untagging a trip or backspacing an edited value could unmount fields or drop recorded answers.
- A boolean switch for yes/no wrote `false` for every toggle shown, leaving a No nobody gave on every trip shown, kept after untagging and counted as answered by stats.

## Decision

A custom field DEFINITION is a row with a scope, and one rule builds every form. Definitions live in `custom_field_defs`, and each carries its types — `placeTypeIds` for a place definition, `tripTypes` (free-text tags, matched case-insensitively) for a trip definition — plus an `appliesToAllTypes` FLAG — a flag rather than join rows for every type that exists today, because rows would silently fail to apply to a type created tomorrow and the user who ticked "All" would never find out (`api/src/__tests__/placeTypes.test.ts`, §7.4). `defsForType` (`shared/src/tripLogFields.ts`) is the one rule both clients build a place form from, so a phone and a browser cannot disagree about which fields a campsite has.

- **The seven canyon grades are ordinary field values now** (`fieldValues`, keyed by RESERVED keys the system definitions own). A user field that would collide with one is refused with a suggestion, on create AND on rename (`placeTypes.test.ts`, §7.6). Anything reading a grade goes through `numericFieldValue`/`fieldValue`, never a column.
- **"Reserved" and "already drawn by another control" are DIFFERENT SETS, and conflating them deletes fields.** `RESERVED_FIELD_KEYS` answers "may a user take this key" and covers every system definition — including the campsite's `capacity` and `is a cave?`. `CANYON_FORM_FIELD_KEYS` (derived from the canyon scoping, pinned by `shared/src/placeTypes.test.ts`) is the set with bespoke controls.
- **A TRIP's form is `tripFieldDefs(defs, the trip's own TYPES, stored values, edited keys)` — and the two union clauses are what stop it eating data.** (Changed 2026-09-13: a trip definition carries `tripTypes` and a place definition `placeTypeIds` — the API refuses a write that fills the other.) Render the definitions scoped to the trip's tags (case-insensitively), UNION any key already stored, UNION any key typed into since the form opened. Both clients save exactly the fields shown, so without the stored half untagging a trip or rescoping a definition drops a recorded answer, and without the edited half ticking a tag, filling in its attribute and unticking it again drops an unsaved one. Keyed on EDITED, not on "has a value now", or backspacing to empty unmounts the field under the cursor. Guard: `shared/src/tripLogFields.test.ts`, "tripFieldDefs".
- Both clients hold both halves as ONE kept-keys set and list kept-only fields under "Leftover attributes", each with a remove button — clearing is no way out for every kind of field, and nothing else said which ones were leftovers.
- A YES/NO is three states (— / Yes / No) on both mobile forms: a switch wrote `false` for every toggle shown, which left a No nobody gave on every trip the attribute was ever shown on, kept after untagging and counted as answered by the stats (`mobile/src/customFields/fieldValueCoercion.test.ts`). Logjam Web draws the same three states as a `ChipRail` (`frontend/src/components/dialogs/CustomFieldInput.render.test.tsx`).
- The canyoning tag that decides which of these a canyon trip is asked is force-added only for a linked CANYON (`linksCanyon`, `shared/src/tripName.ts`).
- Write only the fields the form SHOWED, over the stored object — iterating every definition wrote a null for the ones scoped to other types, and a null removes the key.

## Consequences

- **Positive:** phone and browser agree on form fields for any type; previously stored and newly typed values are preserved during tagging changes; reserved system keys cannot be collided with or deleted.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

- Storing field definitions on `User.uiPreferences`: replaced by the `custom_field_defs` table.
- Join rows for "applies to all types": rejected because rows silently fail to apply to new types created later; replaced by `appliesToAllTypes` flag.
- Canyon grades as database columns: replaced by `fieldValues` keyed by reserved keys, accessed via `numericFieldValue`/`fieldValue`.
- Conflating `RESERVED_FIELD_KEYS` with controls drawn specially: rejected because it silently removed campsite `capacity` and `is a cave?`; separated into `CANYON_FORM_FIELD_KEYS`.
- Scoping trip definitions by linked place types: changed 2026-09-13; trips can be logged without places, so scoped by `tripTypes` tags instead.
- Switch for boolean Yes/No: rejected because writing `false` created unwanted answers; replaced by three-state (— / Yes / No) / `ChipRail`.
- Force-adding canyon tag for any linked place: rejected because it tagged non-canyons (e.g. campsite stays); restricted to `linksCanyon`.
- Iterating every definition when saving: rejected because it wrote null for fields of other types, deleting keys.
