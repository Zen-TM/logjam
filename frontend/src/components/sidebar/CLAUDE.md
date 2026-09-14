# Sidebar — Logjam

## Architecture

**NavRail** (84px rail of labelled pills, `--nav-rail-width`) + **SidebarPanel** (380px page to its right, `--panel-width`, the same width as the filter sheet that opens beside it). Narrow web (≤768px) swaps the rail for a 68px tab bar (Map · Places · Logs · Ways · More) and the panel for `BottomSheet.tsx`. No router — page navigation is state-driven via `activePanel: PanelId | null`. Page ids and titles live in `panels.ts`; a page with two views swaps them under a chip rail in `SidebarPanel`. Layout rules: `frontend/DESIGN.md` §2.

## NavRail / SidebarPanel

Exact sizing, spacing and animation values live in `NavRail.module.css`, `SidebarPanel.module.css` and the tokens in `src/index.css` — read them rather than duplicating here. Fixed points:

- Icons are lucide-react. The rail's groups: Places, Logs, Ways, Maps and Friends, a spacer, then Inbox, Account and Settings.
- The panel's close button is the kit `IconButton` ("Close panel").
- A page not yet rebuilt scrolls inside the panel body (`overflow-y: auto`, `flex: 1`). A rebuilt page (`places`, `place-detail`, marked by `data-active-panel`) owns its layout instead: hero and rails pinned, only its list scrolls. Never nest a second scroll container inside either.

## Toggle behaviour

Clicking the active NavRail icon **closes** the panel (`activePanel → null`).
Clicking a different icon **switches** to that panel.
On narrow web, the Map tab closes the panel.
`place-detail` can also be opened programmatically.

## Conventions log (additive)

_(none yet)_
