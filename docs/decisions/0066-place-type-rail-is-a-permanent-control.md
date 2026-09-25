# 0066. On Logjam Web, the place-type rail is a permanent control and the attribute filters follow it

- **Date:** 2026-09-10
- **Status:** Accepted
- **Supersedes:** —

## Context

"Which kind of place am I looking at" is the question people arrive with on the
Places page (Places rework, 2026-09-10; a tab strip until the 2026-09-13
redesign).

## Decision

- The place-type rail is a permanent control, not a filter row: it gets the
  first chip rail under the hero rather than a row inside the filter sheet — and
  it writes `filters.placeTypeId`, so the shared predicate and the map filter
  both honour it with no second code path.
- A type with zero places is left off the rail (`typesWithPlaces` in
  `PlacesPanel`); it is still offered in the create dialog, or you could never
  make your first one. A trailing "New type" chip opens Settings.
- The attribute filters follow the type rail: `defsForType(defs, filters.placeTypeId)`
  decides which attributes the filter sheet offers (`PlaceFilterSheet`), so a
  campsite rail cannot ask for a V grade. On "Any type" every place attribute is
  offered, which is the honest answer for a mixed list.

## Consequences

- **Positive:** Not recorded.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

- **A tab strip** (before the 2026-09-13 redesign) and **a row inside the filter
  sheet**: the source records only that the rail replaced them, not why beyond
  the Context above.
