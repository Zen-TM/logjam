# 0051. A lettered grade is stored as its rank

- **Date:** 2026-11-14
- **Status:** Accepted
- **Supersedes:** —

## Context

The American Canyoneering Association (ACA) rating is written in letters and
numerals: technical 1 to 4, water A, B, C and C1 to C4, time I to VI, risk PG,
PG13, R, X and XX ("3B III R"). A canyon already holds its French grade as three whole-number
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
  reordering or inserting renumbers every place that holds one. Guard:
  `shared/src/placeTypes.test.ts` ("pin every labelled field's labels, in order").
- **`labels` has one word per value from `min` to `max`.** Guard:
  `shared/src/placeTypes.test.ts` ("give a labelled field a label for every
  value"). The migration's rows match the declaration: `api/src/lib/systemRowMigration.unit.test.ts`.
- **Four system definitions carry it:** `aca_technical`, `aca_water`, `aca_time`,
  `aca_risk`, scoped to Canyon, added by one migration
  ([0003](0003-pre-deploy-migrations-expand-contract.md)): it inserts the rows, and
  first renames an account's own place definition that holds one of the four keys to
  `<key>_<n>`, moving its stored values with it. Guard: the migration-upgrade job
  (`api/prisma/upgrade-check/verify.sql`). `formatCanyonGrade` writes the French grade
  when any French field is set and the ACA one otherwise (`shared/src/canyonGrade.test.ts`).
- **No value in `aca_risk` means no stated extra risk,** so a source's lowest level
  is stored as unset, never as `PG`. No test holds this: nothing imports an ACA rating yet.
- **Update 2026-11-14: where a canyon stands decides which grade fields its form
  offers.** A region declares `canyonGrades`, `"french"` or `"aca"` (`shared/src/regions.ts`),
  and a Canyon form offers that system's fields at the place's position, the French
  ones outside every region, plus any grade field that already holds a value, stored
  or typed, so a save never drops one (`gradeFieldsAt`, `placeFormDefs` in
  `shared/src/canyonGrade.ts`), and a plan place's edit form does the same
  (`itemFieldDefs`). An NSW canyon is offered no ACA field. A place filter offers
  the axes of the system in view, plus any a listed place holds a value for or
  the filter is set on (`placeFilterDefs`). A canyon
  holding both systems shows the French grade as its Grade row and the ACA one as a
  second row, "ACA grade". Guards: `shared/src/canyonGrade.test.ts` ("keeps a field
  that already holds a value, whatever the system", "keeps the axis an active filter
  is set on") and `shared/src/planItemEdit.test.ts` ("keep a grade field the place
  already holds, in either system"). Everything else above stands.

## Consequences

- **Positive:** the field type, the database, sync, the bounds check and the
  filter need no change, and ranks order correctly with no mapping, so "C2" sorts
  after "C1" where letters would sort as text. The places list's Grade sort
  (`comparePlaces` in `shared/src/placeFilter.ts`) reads the two difficulty fields of
  the system the map in view uses, then the other system's, so a canyon graded in
  either sorts among the graded ones (updated 2026-11-14). Guard:
  `shared/src/placeFilter.test.ts` ("sorts a canyon graded only in ACA among the
  graded ones").
- **Negative:** a stored 5 means nothing without the declaration. Whatever prints
  a value outside the clients (an export, a raw database read) shows the rank
  unless it calls `fieldValueLabel`. A level added before the first one
  of a list cannot be inserted: it gets a new field, or the data is rewritten in a
  migration.
- **Negative:** a system key is reserved only for attributes made after it
  (`isReservedFieldKey`), so adding the four reserved their keys under any account
  that already held one. The migration renames such an attribute, with its values, to
  `<key>_<n>` (`aca_water_2`), so that account's label stays and its key changes.
  Not measured whether any account holds one.
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
