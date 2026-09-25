# Sidebar — Logjam

## Architecture

**NavRail** (84px rail of labelled pills, `--nav-rail-width`) + **SidebarPanel** (380px page to its right, `--panel-width`, the same width as the filter sheet that opens beside it). Narrow web (≤768px) swaps the rail for a 68px tab bar (Map · Places · Logs · Ways · More) and the panel for `BottomSheet.tsx`. No router — page navigation is state-driven via `activePanel: PanelId | null`. Page ids and titles live in `panels.ts`; a page with two views swaps them under a chip rail in `SidebarPanel`. Layout rules: `frontend/DESIGN.md` §2.

## NavRail / SidebarPanel

Exact sizing, spacing and animation values live in `NavRail.module.css`, `SidebarPanel.module.css` and the tokens in `src/index.css` — read them rather than duplicating here. Fixed points:

- Icons are lucide-react. The rail's groups: Places, Logs, Ways, Maps and Friends, a spacer, then Inbox, Account and Settings.
- The panel's close button is the kit `IconButton` ("Close panel").
- Every page owns its layout: hero and rails pinned, only its list scrolls, and the panel body adds no gutter. The `LEGACY_PAGES` opt-out list is gone — the last page came off it on 2026-09-19 — so there is no plain-header fallback left to join or leave; a new page builds its own hero. Never nest a second scroll container inside.

## Toggle behaviour

Clicking the active NavRail icon **closes** the panel (`activePanel → null`).
Clicking a different icon **switches** to that panel.
On narrow web, the Map tab closes the panel.
`place-detail` can also be opened programmatically.

## Conventions log (additive)

- **The bottom sheet and the desktop panel are the same landmark, with the same name.** `BottomSheet` takes the page `title` and renders `<aside aria-label={title}>`, exactly as `SidebarPanel` does on desktop. It was a bare `<div>`, so a screen-reader user lost the entire panel as a navigable landmark by being on a phone. A branch on `useIsMobile()` may change the furniture; it may not change what the thing IS. (2026-09-19)
- **The sheet's grab bar is `role="slider"`, not a drag-only `<div>`.** Arrow keys step through peek/half/full (shortest first, so taller is a higher value), Home and End jump to the ends, and it clamps. Before this, "full" was a height only a pointer could ask for (WCAG 2.1.1). The pointer drag is unchanged — the keyboard was added beside it, not instead of it. Guard: `e2e/a11y.spec.ts`, "the bottom sheet is a named landmark whose height the keyboard sets", which asserts the sheet's own geometry moves rather than only that the label changed. (2026-09-19)
