# Sidebar — Logjam

## Architecture

**NavRail** (56px fixed icon bar) + **SidebarPanel** (280px flyout to its right). No router — panel navigation is state-driven via `activePanel: PanelId | null`.

## NavRail (`NavRail.tsx` + `NavRail.module.css`)

- Icons: lucide-react at `size={20}`
- Labels: `9px` font, `line-height: 1`
- Default icon opacity: `0.6`; hover/active: `1`
- Active item background: `color-mix(in srgb, var(--theme-secondary) 80%, transparent)`
- Groups: top = feature panels; bottom = notifications, account, settings

## SidebarPanel (`SidebarPanel.tsx` + `SidebarPanel.module.css`)

- Header: `padding: 12px 16px`, `border-bottom: 1px solid var(--theme-secondary)`
  - Title: `var(--text-base)`, truncated with ellipsis
  - Close button: lucide-react `<X size={18} />`
- Body: `padding: 12px 16px`, `flex: 1`, `overflow-y: auto`
- Entry animation: `slideIn` (`translateX(-100%)` → 0) at `var(--transition-med)` ease-out
- Shadow: `var(--shadow-panel)` on the right edge

## Toggle behaviour

Clicking the active NavRail icon **closes** the panel (`activePanel → null`).
Clicking a different icon **switches** to that panel.
`canyon-detail` can also be opened programmatically.

## Conventions log (additive)

_(none yet)_
