# 0051. A lettered grade is stored as its rank

- **Date:** 2026-11-14
- **Status:** Accepted
- **Supersedes:** —

## Context

The American Canyoneering Association (ACA) rating is written in letters and
numerals: technical 1 to 4, water A, B, C and C1 to C4, time I to VI, risk R, X
and XX ("3B III R"). A canyon already holds its French grade as three whole-number
system fields (`v_grade`, `a_grade`, `commitment` in `SYSTEM_FIELD_DEFS`,
`shared/src/placeTypes.ts`), which `formatCanyonGrade` (`shared/src/canyonGrade.ts`)
glues into one string. A field's value, bounds, filter slider, sort and sync
push all work on numbers, and a value is checked against the definition's `min`
and `max` (`invalidPlaceFields` in `shared/src/placeValidation.ts`).

## Decision

- **A lettered grade is stored as a whole number: the position of its word in
  the field's `labels` list, counted from the field's `min`.** "C2" in `aca_water`
  (`min` 1, labels `A, B, C, C1, C2, C3, C4`) is stored as 5. The words live only
  in `SystemFieldDef.labels`; no table, column or wire field carries them, and
  `fieldValueLabel(key, value)` is the one reader.
- **A `labels` list is append-only.** A stored value is a position in it, so
  reordering or inserting renumbers every place that holds one.
- **`labels` has one word per value from `min` to `max`.** Guard:
  `shared/src/placeTypes.test.ts` ("give a labelled field a label for every
  value"). The migration's rows match the declaration: `api/src/lib/systemRowMigration.unit.test.ts`.
- **Four system definitions carry it:** `aca_technical`, `aca_water`, `aca_time`,
  `aca_risk`, scoped to Canyon, added by a migration that only inserts rows
  ([0003](0003-pre-deploy-migrations-expand-contract.md)). `formatCanyonGrade` writes
  the French grade when any French field is set and the ACA one otherwise
  (`shared/src/canyonGrade.test.ts`).

## Consequences

- **Positive:** the field type, the database, sync, the bounds check, the
  filter and the sort need no change, and "C2" sorts after "C1" by construction,
  where letters would sort as text.
- **Negative:** a stored 5 means nothing without the declaration. Whatever prints
  a value outside the clients (an export, a raw database read) shows the rank
  unless it calls `fieldValueLabel`. A standard that adds a level before the first
  one (a risk below R) cannot be inserted: it gets a new field, or the data is
  rewritten in a migration.
- **Negative:** a user's own attribute whose key is already one of the four shares
  that key with the new system field, since system keys are reserved only for
  attributes made after them (`isReservedFieldKey`). Not measured whether any exists.
- **Neutral:** a user's own attributes cannot be lettered; they stay numbers,
  text, dates and yes or no.

## Alternatives considered

- **A "choice" field type holding the option as text.** The obvious one for a lettered
  value, and rejected here: it is a new type in the schema, the sync push allowlist, both
  editors, the filter sheet and the CSV import, and a text value sorts "C" before "C1"
  only by accident of spelling. Nothing but the ACA grade needs it today.
- **One text field holding the whole grade ("3B III R").** Rejected: it cannot be
  filtered or sorted by its parts, and the API cannot check it against bounds.
- **Text fields per part, free to type.** Rejected: nothing refuses "D" or "5",
  and a filter cannot offer a range.
