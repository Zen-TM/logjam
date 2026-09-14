# Sidebar — Logjam

## Architecture

**NavRail** (56px fixed icon bar) + **SidebarPanel** (280px flyout to its right). No router — panel navigation is state-driven via `activePanel: PanelId | null`.

## NavRail / SidebarPanel

Exact sizing, spacing, opacity and animation values live in `NavRail.module.css` and `SidebarPanel.module.css` — read them rather than duplicating here. Fixed points:

- NavRail icons are lucide-react at `size={20}`; groups are top = feature panels, bottom = notifications/account/settings.
- SidebarPanel close button is lucide-react `<X size={18} />`.
- Panel body owns the scroll (`overflow-y: auto`, `flex: 1`) — never nest another scroll container inside it.

## Toggle behaviour

Clicking the active NavRail icon **closes** the panel (`activePanel → null`).
Clicking a different icon **switches** to that panel.
`place-detail` can also be opened programmatically.

## Conventions log (additive)

- **Superseded sizes (2026-09-13):** the rail is 84px with labelled pills and the panel 380px, the same as the filter sheet beside it (`--nav-rail-width`, `--panel-width`); narrow web is a 68px tab bar (Map · Places · Logs · Ways · More). The 56px/280px figures and "bottom strip" above are stale; flagged for the operator to remove. Page ids and titles live in `panels.ts`; a page with two views swaps them under a chip rail in `SidebarPanel`. See `frontend/DESIGN.md` §2.

_(none yet)_
