# Sidebar — Logjam

## Architecture

**NavRail** (84px rail of labelled pills, `--nav-rail-width`) + **SidebarPanel** (380px page to its right, `--panel-width`, the same width as the filter sheet that opens beside it). Narrow web (≤768px) swaps the rail for a 68px tab bar (Map · Places · Logs · Ways · More) and the panel for `BottomSheet.tsx`. No router — page navigation is state-driven via `activePanel: PanelId | null`. Page ids and titles live in `panels.ts`; a page with two views swaps them under a chip rail in `SidebarPanel`. Layout rules: `frontend/DESIGN.md` §2.

## NavRail / SidebarPanel

Exact sizing, spacing and animation values live in `NavRail.module.css`, `SidebarPanel.module.css` and the tokens in `src/index.css` — read them rather than duplicating here. Fixed points:

- Icons are lucide-react. The rail's groups: Places, Logs, Ways, Maps and Friends, a spacer, then Inbox, Account and Settings.
- The panel's close button is the kit `IconButton` ("Close panel").
- A page owns its layout by default: hero and rails pinned, only its list scrolls, and the panel body adds no gutter. The pages not yet rebuilt are listed in `LEGACY_PAGES` (`SidebarPanel.tsx`); they keep the plain header and scroll inside the body, which gives them their gutter. Rebuilding a page means taking it off that list — the list names the OLD pages so a new one cannot forget to opt in, which is how the Gemini Inbox pilot shipped with a doubled gutter and a hero that scrolled away. Never nest a second scroll container inside either.

## Toggle behaviour

Clicking the active NavRail icon **closes** the panel (`activePanel → null`).
Clicking a different icon **switches** to that panel.
On narrow web, the Map tab closes the panel.
`place-detail` can also be opened programmatically.

## Conventions log (additive)

_(none yet)_
