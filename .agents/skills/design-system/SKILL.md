---
name: design-system
description: Use when building, reshaping or reviewing a screen, page, panel, sheet, dialog, kit component, icon, colour or user-facing string in Logjam Web (frontend/) or Logjam GPS (mobile/). Covers where each design rule lives (the UX principles, each client's DESIGN.md, the shared tokens, kit list, icon registry and screen contracts) and the checks a UI change must pass.
---

# Design system

Logjam Web and Logjam GPS are one product drawn twice. A decision both make is
declared once in `@logjam/shared` and each client draws it its own way
([ADR 0020](../../../docs/decisions/0020-share-the-decision-not-the-drawing.md)).

## Where the rules are

| You need | Read |
|---|---|
| What every screen on both clients must do | `docs/ux-principles.md` |
| How Logjam Web applies it (shell, sheets, dialogs, kit, a11y) | `frontend/DESIGN.md` |
| How Logjam GPS applies it (sheets, the map, offline, kit) | `mobile/DESIGN.md` |
| A colour, space, size, radius, font or duration | `shared/src/designTokens.ts`, `shared/src/themeSchemes.ts` |
| Which components the kit has, on which client | `KIT_COMPONENTS` in `shared/src/kit.ts` |
| Which glyph stands for an idea | `shared/src/icons.ts` |
| A shared screen's sections, order, copy and empty states | its contract in `shared/src/contracts/` |

Read the principles section for what you are touching, not the whole file.

## Every UI change

1. **Open the other client's counterpart first.** If the screen exists there,
   its contract already decides the sections, order, words and empty states:
   render from the contract, never restate it. Logic both need goes to
   `shared/` with a test.
2. **Compose the kit** (`frontend/src/ui`, `mobile/src/ui`). A shape the kit
   lacks is added to the kit, under the same name on both clients when both
   need it, and joins `KIT_COMPONENTS`.
3. **Name roles, never values**: a colour role token, a space step, an icon
   idea. A new glyph for an idea joins the registry; never import a glyph for
   an idea that already has one.
4. **A new foreground/background pair joins `scripts/wcag-contrast.mjs`**,
   measured on the surface it renders on, under every scheme. Its
   `KNOWN_FAILURES` only shrinks.
5. **Look at it in every scheme**, Daylight included, at 1440 and 390 on the
   web and on the emulator for GPS, using the seed's made-up data only. The
   `local-testing` skill has the stack.
6. **A new web surface joins `frontend/e2e/a11y.spec.ts`.**
7. **Changing a convention changes its doc in the same commit**: a shared rule
   in `docs/ux-principles.md`, a medium rule in that client's `DESIGN.md`.
   Neither doc lists what a declaration already holds.

## User-facing copy

Name the surface: Logjam Web or Logjam GPS, never "the app". Helper text and
tooltips follow `docs/ux-principles.md` §12: one plain sentence saying what a
setting means, an example over a rule, and none at all when the label says it.
Errors go through `messageFromError` (web) or our own sentence (GPS), never an
error's message: it can carry a place name.
