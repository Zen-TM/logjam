# Sidebar Panels — Logjam

## Rules (all mandatory)

- **Build on `frontend/DESIGN.md` and the `src/ui` kit** (Hero, ChipRail, Row, Menu, SideSheet, FilterField…). `PlacesPanel.tsx` and `PlaceFilterSheet.tsx` are the reference. MUI is an ESLint error outside `MUI_LEGACY_FILES`; no panel is on that list any more, and `shared.module.css` — whose `.btn` compositions this entry warned against — was deleted with its last consumer (2026-09-19).
- **No inline `style` props**, except to set a custom property the kit reads (`--tile-hue`, `--chip-hue`). All other styling in the co-located `.module.css`.
- **No import from `Map.tsx`** — panels receive callbacks as props from `App.tsx`.
- **Scrolling:** a rebuilt page pins its hero and rails and scrolls only its list; a panel not yet rebuilt relies on the `SidebarPanel` body's scroll. Never nest a second scroll container (see `../CLAUDE.md`).

## Conventions log (additive)

- **The place-type rail is a permanent control, not a filter row.** "Which kind of place am I looking at" is the question people arrive with, so it gets the first chip rail under the hero rather than a row inside the filter sheet — and it writes `filters.placeTypeId`, so the shared predicate and the map filter both honour it with no second code path. A type with zero places is left off the rail (`typesWithPlaces` in `PlacesPanel`); it is still offered in the create dialog, or you could never make your first one. A trailing "New type" chip opens Settings. (Places rework, 2026-09-10; a tab strip until the 2026-09-13 redesign)
- **The attribute filters follow the type rail.** `defsForType(defs, filters.placeTypeId)` decides which attributes the filter sheet offers (`PlaceFilterSheet`), so a campsite rail cannot ask for a V grade. On "Any type" every place attribute is offered, which is the honest answer for a mixed list. (2026-09-10)
