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

_(none yet)_
