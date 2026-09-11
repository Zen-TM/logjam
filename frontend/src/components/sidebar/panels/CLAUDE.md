# Sidebar Panels — Logjam

## Rules (all mandatory)

- **No inline `style` props.** All styling in co-located `.module.css`.
- **No MUI `<Button>`** — compose CSS module classes from `shared.module.css`.
- **No MUI `<Typography>` with `sx`** — style text via CSS module classes.
- **No import from `Map.tsx`** — panels receive callbacks as props from `App.tsx`.
- Scroll is handled by `SidebarPanel` body — never add `overflow-y: auto` to panel root.

## Button by purpose

| Purpose | Composition |
|---|---|
| Primary action | `btnFilledAccent` + `btnMd` |
| Secondary / neutral | `btnFilledNeutral` + `btnMd` |
| Add / accept (inline) | `btnOutlineAccent` + `btnSm` or `btnOutlineBonus1` + `btnSm` |
| Delete / decline | `btnOutlineWarning` + `btnSm` or `btnMd` |
| Low-emphasis (refresh, clear) | `btnGhost` + `btnFull` |

## Typical structure

```tsx
<div className={classes.root}>
  <div className={classes.sectionLabel}>Section</div>   {/* composes .sectionLabel */}
  <div className={classes.divider} />                    {/* composes .divider */}
  {/* list content — no nested overflow-y: auto */}
  <button className={classes.primaryBtn}>…</button>      {/* composes .btn .btnFilledAccent .btnMd .btnFull */}
</div>
```

## Conventions log (additive)

- **The place-type tabs are a permanent control, not a filter row.** "Which kind of place am I looking at" is the question people arrive with, so it gets a tab strip above the search box rather than a row inside the collapsed filter accordion — and it writes `filters.placeTypeId`, so the shared predicate and the map filter both honour it with no second code path. A type with zero places is left out of the strip (`typeTabs` in `PlacesPanel`); it is still offered in the create dialog, or you could never make your first one. (Places rework, 2026-09-10)
- **The custom-field filter section follows the tab.** `defsForType(defs, filters.placeTypeId)` decides which fields the accordion offers, so a campsite tab cannot ask for a V grade. On "All" every place field is offered, which is the honest answer for a mixed list. (2026-09-10)