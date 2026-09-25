# 0037. Logjam GPS places: one type vocabulary, attribute forms built from scoped definitions

- **Date:** 2026-09-10
- **Status:** Accepted
- **Supersedes:** —

## Context

The places rework (root `AGENTS.md`, "A place has a TYPE") made `Canyon` and
`Waypoint` one `Place` whose `PlaceType` decides which questions it asks. On the
phone that meant every surface listing types, and every form built from custom
field definitions, had to agree. These are the rules the phone side settled on.

## Decision

### The type vocabulary

**The type is the vocabulary, and every surface reads it from ONE place:
`useMirrorPlaceTypes`.** The tab rail on Places, the create form's picker, the
map layer sheet's children and the pin colours are all built from that hook, so
they cannot disagree about which types exist. `listMirrorPlaceTypes` sorts
system-first explicitly rather than trusting the engine — SQLite sorts NULLs
first, Postgres sorts them last, and the leftmost tab is decided by it.

**An EMPTY type mirror answers with the compiled-in system types.** A guest
never syncs and a fresh account has not pulled yet, so a picker built from an
empty table would make creating a place impossible for exactly the user who has
no way to fix it. Same argument as `SYSTEM_FIELD_DEFS` being the bounds a
validation uses with no signal. Guard: `sync/placeTypesFallback.test.ts`.

**A type tab is decided over the WHOLE collection; its badge counts what the
other axes leave.** A rail that reshuffles under the thumb on every keystroke is
worse than a chip that goes quiet, so membership (does this tab exist?) is a
fact about the library, while the number on it answers "how many would I get if
I tapped this" — the same split the bucket rail already used.

**The type rail is a filter the user can SEE, so it does not also count as a
hidden one.** `filters.placeTypeId` is an ordinary `PlaceFilters` key and
`activePlaceFilterCount` counts it, which is right for the sheet and wrong for
the "N filters active" warning sitting directly under the rail that says so. The
screen subtracts the rail's own axis while the rail is on screen; Reset leaves
the tab standing (the rail is that axis's control, and "All" is one tap).

**Place types are managed in SETTINGS** (`places/PlaceTypesEditor.tsx`), beside
the attribute lists — a list you keep, not a preference you set. The FORM is
also reachable from the Places tab's type rail, as a trailing "New type" chip
(`NEW_TYPE` in `PlacesScreen.tsx`): the rail is a filter, but it is also the
only place a user looks at their own types and thinks about them, and "there is
no tab for the kind of place I mean" is the moment to offer one. The chip is an
ACTION — `selectType` intercepts it and leaves the selection alone — and the
rail is now always on screen, because hiding it until a second type has places
in it would have hidden the affordance from exactly the accounts that need it.
Only ADD is offered there; editing and deleting belong with the list. The sync
push has accepted `placeType` create/update/delete since the rework; the phone
simply had no screen for it, so a phone-only user could not add a type at all.
A delete is refused locally when places still use the type, because the server
refuses it too (409) and a queued op would park as a dead push.

**BUILT-INS SORT LAST in a list you keep, and FIRST in a rail you filter with.**
Two different questions. `CustomFieldList` and `PlaceTypeList` put the rows with
no verbs on them at the bottom, because the half above is what the user came to
change; `GET /place-types` and the Places rail keep system types first, because
the leftmost tab and a new place's default type are decided by that order.

### Definitions and forms

**Definitions reach the phone WITH their scoping, or no form can be
type-specific.** `customFieldDefsFromRows` drops `placeTypeIds` /
`appliesToAllTypes` — a `TripLogCustomFieldDef` has no room for them — so
`loadFieldDefs` builds `ScopedCustomFieldDef`s itself, the same flatMap the
server's `loadScopedDefs` does. Two bugs lived in that gap: every place form
rendered every place field (a campsite asking for a V grade), and a field
created on the phone reached the server scoped to NOTHING, so it existed in
Settings and on no form at all. The editor now asks where a field appears — or
infers it, when opened from a place's own form, because the user already
answered by being there — and refuses a definition scoped to nothing.

**A definition that names no place types must be ON EVERY FORM, not none.** Both
readers ask "all types, or one of these?" (`defsForType`, `tripFieldDefs`), so a
row with `appliesToAllTypes` false and an empty scoping lists in Settings and
appears nowhere else — which reads as the save having failed. That is what every
caller predating the scoping produced, and what every trip-log write produced
while a trip field had no type picker to answer with (it has one now — trip
TYPES, the tags — and the editor refuses an empty scoping for both entities):
`20260906010000` backfilled `entity = 'place'` only, so ALL THREE of alice's
trip attributes were invisible on the trip form. `createFieldDef` now defaults
the flag to "on when no types were named", `20260911140000` repairs the existing
rows, and the mobile editor still refuses the state outright for a place field.
Found by reading the phone's mirror, not by a test; guard is
`api/src/__tests__/customFields.test.ts`, "puts a definition that names no place
types on every form".

**A user's own field is an ATTRIBUTE in the UI and a field in the code.** "Field"
names the box, not the thing the box records. `ATTRIBUTE_NOUN`
(`customFields/CustomFieldsEditor.tsx`) is the one declaration every surface
reads, including the article in "Add an attribute" — a rename that composes
"a"/"an" from the noun is how this kind of constant half-works. The column, the
table, the sync entity and every function keep saying field.

**A bounded integer is a RAIL, by shape rather than by name.** The seven canyon
axes were seven hand-written controls in `PlaceEditSheet` with their reserved
keys spelled out, and were then subtracted from the generic list (via
`CANYON_FORM_FIELD_KEYS`) so they were not asked twice. They are ordinary field
values with ordinary definitions: `railStops`
(`customFields/fieldValueCoercion.ts`, tested) answers from the definition's own
bounds, and `CustomFieldValueInput` draws the rail. Three things fell out —
canyon fields finally appear in "Your place attributes", `quality` gets a
decimal box because it is a FLOAT and a rail could never express the 4.5
Logjam Web stores, and a user's own "Difficulty, 1-5" is drawn like a V grade
without anything knowing about canyons. Logjam Web still draws its own canyon
controls; `CANYON_FORM_FIELD_KEYS` survives for `PlaceDialog.tsx` alone.

**A yes/no is the same row of stops: — / Yes / No.** A switch has no empty
state, so every form wrote `false` for every toggle it showed, touched or not —
a No nobody gave, counted as answered, and on a trip kept after the tag that
asked for it came off. "—" is unset and saves nothing; No is an explicit
`false`, which is what a filter for No reads. A date gets the same way back to
blank: "Clear date" in the sheet's date mode.

**Form sheets re-seed on the entity's ID, never on the object.** A detail screen
passes the live mirror row, which is a new object after every mirror change — a
sync pull, an upload tick, an inbox refresh — so keying the seed effect on it
wiped whatever the user was typing. And a save compares stored values with
`sameFieldValues`, never `JSON.stringify`: Postgres `jsonb` returns keys in its
own order, so text comparison reported a change on every save and re-sent every
value over any newer one.

**A place's OVERVIEW holds what every place has, which is its position.** It
used to promote four canyon scalars into stat tiles by reading their reserved
keys — not universal, already listed below in the type's own table, and
"Rating" was a bespoke relabelling of a definition labelled "Quality", so one
field had two names on one screen.

**A definition with no owner id is not necessarily a built-in.** A definition
created on the phone has none until the server sends one back, and
`ownerId === null` alone drew a padlock on the field the user had just added.
`isSystemFieldDef` also requires a RESERVED key, which is exact rather than
heuristic: every built-in's key is reserved by construction, and
`assertKeyNotReserved` refuses a reserved key on create and rename for both
entities.

### Values that do not fit

**`foreignFields` actions are ONLINE-ONLY and that is deliberate, not an
oversight.** The field is not client-writable (it is absent from the push
allowlist by design), so an offline adopt would need an op carrying a
definition create AND a value move atomically. The three rows say "Needs a
connection" rather than failing at the tap — the same rule sharing follows.

**`foreignFields` has two causes and the section is named for the CONDITION:
"Doesn't fit this type".** A type change strands what the new type has no
definition for; a copy carries values keyed by the sender's. "Came with this
place" was only ever true of the second. `forkedFromId` (carried through the
mirror read) is how a screen tells them apart for the sentence underneath.

**A type change runs BOTH WAYS.** `strandValuesOnTypeChange` feeds the park back
through the same split, so a key the new type defines comes home to
`fieldValues` automatically. Without that half retyping was a one-way door:
canyon -> campsite stranded the canyon axes and campsite -> canyon left them
stranded beside a form with an empty V-grade rail, while adopting them is
REFUSED (409) because those keys are reserved. The UI disables adopt on a
reserved key rather than 409ing on the tap, and says it comes back by itself.

**A parked attribute is a CARD; a recorded one is a table row.** The "Doesn't
fit this type" rows use the shared `Row` (surface, chevron, press) and the
type's own attributes use a transparent hairline table. They look different
because they are different: one is a list of facts, the other is a list of
decisions. The table style that stopped the facts inviting a tap took the
invitation off the decisions too.

**An action that can NEVER apply is hidden, not disabled.** "Create a new
attribute for this place type" is absent on a reserved key rather than greyed
with an explanation — the system definition owns that key and the API answers
409, so it is not unavailable right now, it does not exist for this value. A
disabled row invites a tap and then explains itself.

## Consequences

- **Positive:** a phone and Logjam Web build the same form for a type; a guest
  can create a place before any sync.
- **Negative:** `foreignFields` actions do nothing offline.
- **Neutral:** Logjam Web still draws its own canyon controls, so
  `CANYON_FORM_FIELD_KEYS` survives for `PlaceDialog.tsx`.

## Alternatives considered

- An offline `foreignFields` adopt: not built. Upgrade path if the field asks
  for it: a `foreignField` push op with those two effects.
- Seven hand-written canyon controls: replaced by the shape-driven rail.
- A switch for yes/no: rejected, it has no empty state.
- Hiding the type rail until a second type has places: rejected, it hid the
  "New type" affordance from the accounts that need it.
