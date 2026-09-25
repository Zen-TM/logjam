# 0022. Share the decision, not the drawing

- **Date:** 2026-09-25
- **Status:** Accepted
- **Supersedes:** —

## Context

React Native draws native views; Logjam Web draws DOM. A spec generating both
must express hover/focus (absent in RN), bottom-sheet gestures and snap points,
`role`/`aria-*` vs `accessibilityRole`/`accessibilityState`, media/container
queries (and the 768px breakpoint's two mechanisms), and two different MapLibre
libraries (GL JS vs Native). It ends up either too thin to matter or two UI
frameworks with a third language on top — and the expensive parts of every
screen are exactly what it can't express.

Drift has come from *deciding* twice:
- A sheet flag naming one page so no other page's sheet could move the map;
- The docked/narrow sheet placement written out in two panel modules, one drifting;
- `ADDED_COLUMNS` vs `CREATE TABLE`;
- Seed ids vs `parsePushOp`.

## Decision

**Share the decision, not the drawing.** No generated cross-platform UI.

- Use kit parity and a screen contract for every surface that exists on both
  clients (such as the places filter-sheet convergence the Places contract forces).
- Share declarations, data logic, and predicates rather than drawing code.
- The worked example of the fix is the attribute-filter package: the filter
  predicate is written once (`shared/src/customFieldFilter.ts`) for places and
  trips, the control is chosen by the definition's shape in one kit component
  (`frontend/src/ui/AttributeFilter.tsx`), and the phone moved onto the same
  predicate in the same change.

## Consequences

- **Positive:** Avoids a brittle, leaky third abstraction layer over React
  Native and the DOM; eliminates drift by sharing logic and predicates instead of
  re-deciding behavior on each platform.
- **Negative:** Not recorded.
- **Neutral:** UI components must be implemented natively for each platform
  (React Native views vs DOM) while adhering to shared contracts and kit parity.

## Alternatives considered

- Generated cross-platform UI: rejected because a spec generating both must
  express hover/focus, bottom-sheet gestures and snap points, `role`/`aria-*` vs
  `accessibilityRole`/`accessibilityState`, media/container queries, and two
  different MapLibre libraries (GL JS vs Native), ending up either too thin to
  matter or two UI frameworks with a third language on top.
- Deciding twice across clients: rejected; deciding twice caused repeated drift
  (`ADDED_COLUMNS` vs `CREATE TABLE`, seed ids vs `parsePushOp`, docked/narrow
  sheet placement drifting in two modules).
