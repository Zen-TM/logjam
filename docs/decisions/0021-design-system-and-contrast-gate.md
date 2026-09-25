# 0021. Design system placement and the WCAG contrast gate

- **Date:** 2026-09-13
- **Status:** Accepted
- **Supersedes:** —

## Context

Every screenshot anyone looks at is Sandstone, and a colour pair that reads
fine there can fail badly elsewhere: the phone's hero puts `textMuted` on
`bonus2` (3.94:1 in Sandstone) and `textPrimary` on `bonus2` (2.43:1 in
Ironbark, where `bonus2` is a LIGHT green), and it shipped that way (found
2026-09-13 while designing Logjam Web).

Using the scheme's `primary` as a label clears 4.5:1 on the accent and on the
light place-type palette, which is why it looked like a rule; however, on the
reserved shared heath `#B79EC0` it is 3.7:1 (Sandstone) and on the GeoPDF asset
hue 2.7:1. The phone's active "Shared" rail chip was that failing pair.

## Decision

- **Design system exists and is on `main`:** `shared/src/designTokens.ts`,
  `shared/src/themeSchemes.ts`, `scripts/wcag-contrast.mjs` in CI,
  `frontend/DESIGN.md`, `mobile/DESIGN.md`, `frontend/src/ui/` (Button, Chip,
  Choice, Dialog, Row, SideSheet, TextField, Feedback, Hero, Menu, RangePills,
  MapControl, AttributeFilter, SettingsRow, Stats, …). Build on these; never a
  parallel token system.
- **A colour pair is measured under all FOUR schemes before it ships, never
  judged by eye in one.** A new foreground/background pair — a surface, a tint,
  a label on a fill — joins `scripts/wcag-contrast.mjs` (text 4.5:1, UI 3:1) in
  the same change. CI runs it (`shared` job). A pair that fails today and ships
  anyway goes in its `KNOWN_FAILURES` with where it renders — the list can only
  shrink, because a known failure that starts passing fails the run. The two hero
  pairs above are on it; the GeoPDF and waypoint hues failed 3:1 as glyphs on
  Sandstone and were lifted rather than listed.
- **Text or a glyph ON a colour fill uses a dark ink, not the scheme's
  `primary`.** The one fixed ink is `INK` in `shared/src/designTokens.ts` (Logjam
  GPS `Chip`; Logjam Web `--ink`), and `scripts/wcag-contrast.mjs` measures it on
  every fill.

## Consequences

- **Positive:** Contrast regressions across all four schemes are caught
  automatically in CI; text and UI elements meet WCAG thresholds (text 4.5:1, UI
  3:1); a single authoritative design token system prevents divergence.
- **Negative:** A pair that fails today and ships anyway must be listed in
  `KNOWN_FAILURES` with where it renders.
- **Neutral:** `KNOWN_FAILURES` can only shrink: a known failure that starts
  passing fails the run.

## Alternatives considered

- Judging colour pairs by eye in one scheme (Sandstone): rejected because a
  pair that reads fine in Sandstone can fail badly in another scheme (e.g.
  `textPrimary` on `bonus2` is 2.43:1 in Ironbark).
- Using the scheme's `primary` for labels/glyphs on fills: rejected because on
  the reserved shared heath `#B79EC0` it is 3.7:1 (Sandstone) and on the GeoPDF
  asset hue 2.7:1.
- Parallel token system: rejected; build on `shared/src/designTokens.ts` and
  `shared/src/themeSchemes.ts`.
- Listing GeoPDF and waypoint hues in `KNOWN_FAILURES`: rejected; they were
  lifted rather than listed.
