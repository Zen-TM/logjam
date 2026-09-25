# 0032. A glyph on a line-placed symbol layer has its ink centred in its advance box

- **Date:** 2026-08-30
- **Status:** Accepted
- **Supersedes:** —

## Context

MapLibre centres a line-placed label on the box the font declares, not on the
ink, so a glyph drawn off-centre inside its own box is drawn off-centre on the
line — and with `textKeepUpright` off it rotates with the line, so the error
swaps sides wherever the line doubles back, which reads as jitter rather than as
an offset. The route direction arrows used `\u203A` (a single angle QUOTE):
measured out of the shipped SDF pack its ink sits 2.0px low at the 24px glyph
em, half the width of the 3dp line it rides on.

## Decision

Route direction arrows use `\u2192`, which measures 0.0/0.0, because arrow
glyphs are drawn on the font's math axis, which is the assumption MapLibre's
centring makes. Punctuation is not.

Guard: `src/map/routeArrowStyle.test.ts` reads the glyph out of
`assets/basemap/basemap-assets.zip` and fails on both an off-centre glyph and
one the pack does not ship (the second is otherwise silent — a missing glyph
renders no text and no error).

## Consequences

- **Positive:** the arrows sit on the line and do not appear to jitter.
- **Negative:** Not recorded.
- **Neutral:** any new glyph on a line-placed layer must pass the same test.

## Alternatives considered

- `\u203A`: rejected, 2.0px low at the 24px em.
