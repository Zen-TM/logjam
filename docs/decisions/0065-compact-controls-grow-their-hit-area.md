# 0065. A compact control grows its hit area, not its rendered box

- **Date:** 2026-07-16
- **Status:** Accepted
- **Supersedes:** —

## Context

A compact control (an icon button, a small text button, a checkbox) needs a
44x44 target to meet HIG/Material/WCAG. Forcing a visual 44px onto every
control instead was measured on the Log Trip form at 390x844: it adds **77px**
of scroll and pushes the whole attribute stack under the soft keyboard, for
controls whose mis-tap cost is zero (a 342px-wide text field).

## Decision

A compact control grows its HIT AREA to 44x44 through a centred
pseudo-element while its rendered box stays put, so the target meets the
guidelines without changing the form's vertical rhythm. The kit does this —
`IconButton`, `Checkbox` and `Button compact` all carry it. The pseudo-element
expands into the row's dead gap only — it never overlaps the neighbouring
input's target.

A dialog's FOOTER buttons are the exception that gets a real height: they are
the primary actions and sit outside the scrolling body, so the pixels are free.

## Consequences

- **Positive:** Not recorded.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

- **A visual 44px on every control:** rejected — 77px of extra scroll on the Log
  Trip form at 390x844 and the attribute stack under the soft keyboard.
