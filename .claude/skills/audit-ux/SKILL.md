---
name: audit-ux
description: Token-efficient UI/UX consistency and usability audit of the Logjam frontend. Checks MUI usage consistency, duplicated/divergent CSS, accessibility, and loading/error/empty states across React components. Uses a scoped repomix pack and a sonnet subagent, writes docs/audits/<date>/ux.md. Use when the user asks to audit UI, UX, consistency, accessibility (a11y), design polish, or run /audit-ux.
---

# UX & Consistency Audit

Owns: **frontend consistency, usability, accessibility**. Boundary priority below security/privacy (shared §5). ID prefix `UX`.

## Roles — read which one you are FIRST

- **Standalone** (`/audit-ux`, you are the main agent): you are the **driver**. Do *Driver steps* — pack, then spawn ONE worker subagent to run *Execution*.
- **Under `audit-all`** (you were already spawned as the worker subagent): **you cannot spawn another subagent.** The orchestrator already created `.audit-tmp/ux.repomix.txt`. Skip *Driver steps* — run *Execution* yourself.

## Driver steps (standalone only)

1. Read `.claude/skills/audit-shared/schema.md`.
2. Verify repomix (`npx repomix --version`; fail loud if absent). Pack (below); assert the output exists and is non-empty.
3. Spawn ONE subagent via the Agent tool — `subagent_type: general-purpose`, **`model: sonnet`**. Hand it the pack path, the schema path, and the **Execution** section below. Tell it: write the report, do NOT spawn further subagents.
4. When it returns: report counts + path. Delete only `.audit-tmp/ux.repomix.txt`.

Pack — theme is the file `frontend/src/theme.ts`, NOT a `theme/` dir (a stale `theme/**` glob silently packs nothing); `frontend/src/**/*.module.css` catches `styles/shared.module.css` + all panel CSS; `index.css` is the global non-module sheet:
```bash
npx repomix --include "frontend/src/components/**/*.tsx,frontend/src/**/*.module.css,frontend/src/theme.ts,frontend/src/themePreferences.tsx,frontend/src/index.css,shared/src/themeSchemes*" --compress --remove-empty-lines --output ".audit-tmp/ux.repomix.txt" --style markdown
```

## Execution (the audit work — whoever runs it; do NOT spawn subagents)

Read `.claude/skills/audit-shared/schema.md` if you haven't (§3 format, §4 verify, §5 boundary, §6 continuity). Read the pack `.audit-tmp/ux.repomix.txt` for the map, then **open real component/CSS files** for every line you report (compression strips CSS rule bodies — open `.module.css` raw to compare; §4). Apply the rubric. Write `docs/audits/<DATE>/ux.md` (incl. Continuity vs the previous run — UX silently regressed 15→4 findings between past runs because continuity wasn't tracked; do not let a prior finding vanish unaccounted). Under `audit-all`, delete nothing; standalone, the driver handles cleanup.

### Rubric

- **MUI consistency**: same semantic action styled differently across components (button variants, spacing, color tokens). Inline `sx` re-implementing what the theme already defines. Hardcoded colors/px instead of theme tokens (`shared/src/themeSchemes`).
- **CSS duplication / divergence**: near-identical rules across `*.module.css` that should share a token or class; one panel's styling drifting from a sibling (e.g. `CanyonDetailPanel` vs other panels, `GeoPdfDialog` vs `TopoExportDialog`).
- **Accessibility**: missing `aria-label` on icon-only buttons, non-semantic clickable `<div>`, no keyboard path for the click-anchor-click canyon selection, color-contrast risks, missing focus states, images without alt.
- **State coverage**: every async action (export, topo job, sign-in, map load) has loading + error + empty states. Silent failures or spinners with no error fallback = medium+.
- **Data completeness in lists**: a `findMany` with a hard `take` cap and no cursor/pagination (e.g. `tripLogsGlobal.ts` `take: 500`), or list UI that renders a truncated set with no "load more" / count indicator — users silently lose access to data past the cap.
- **Interaction clarity**: destructive actions (remove selected canyon) confirmed/undoable; ambiguous affordances; inconsistent dialog patterns.

Severity by user impact (broken/inaccessible = high; cosmetic drift = low). Verify by reading the component/CSS. Skip pure formatting nits unless they change meaning. Tag confidence.
