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
`canyon-detail` can also be opened programmatically.

## Conventions log (additive)

_(none yet)_
