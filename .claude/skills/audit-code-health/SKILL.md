---
name: audit-code-health
description: Token-efficient code health audit of the Logjam codebase. Mechanical scan for dead code, duplication, type holes (any/ts-ignore/non-null), swallowed errors, and test-coverage gaps across frontend, api, and shared. Uses scoped repomix packs and a sonnet subagent, writes docs/audits/<date>/code-health.md. Use when the user asks to audit code quality, find dead code, duplication, tech debt, type safety, error handling, test gaps, or run /audit-code-health.
---

# Code Health Audit

Owns: **maintainability mechanics** — dead code, dupes, type holes, swallowed errors, test gaps. Lower boundary priority (shared §5); cross-ref security/privacy/ux rather than restating their findings. ID prefix `CH`.

## Roles — read which one you are FIRST

- **Standalone** (`/audit-code-health`, you are the main agent): you are the **driver**. Do *Driver steps* — pack, then spawn ONE worker subagent to run *Execution*.
- **Under `audit-all`** (you were already spawned as the worker subagent): **you cannot spawn another subagent.** The orchestrator already created `.audit-tmp/code-health.repomix.txt`. Skip *Driver steps* — run *Execution* yourself.

## Driver steps (standalone only)

1. Read `.claude/skills/audit-shared/schema.md`.
2. Verify repomix (`npx repomix --version`; fail loud if absent). Pack (below); assert the output exists and is non-empty.
3. Spawn ONE subagent via the Agent tool — `subagent_type: general-purpose`, **`model: sonnet`**. Hand it the pack path, the schema path, and the **Execution** section below. Tell it: write the report, do NOT spawn further subagents.
4. When it returns: report counts + path. Delete only `.audit-tmp/code-health.repomix.txt`.

Pack — TS/JS only; Python `topo/` is OUT of scope here (its structural concerns are architecture-owned). The `*.unit.test.ts` ignore matters — those are colocated next to source in `lib/`/`services/`, and reading them as source pollutes the test-gap scan:
```bash
npx repomix --include "frontend/src/**/*.{ts,tsx},api/src/**/*.ts,shared/src/**/*.ts" --ignore "**/*.test.ts,**/*.test.tsx,**/*.unit.test.ts,**/dist/**,**/node_modules/**" --compress --remove-empty-lines --output ".audit-tmp/code-health.repomix.txt" --style markdown
```

## Execution (the audit work — whoever runs it; do NOT spawn subagents)

Read `.claude/skills/audit-shared/schema.md` if you haven't (§3 format, §4 verify, §5 boundary, §6 continuity). Read the pack `.audit-tmp/code-health.repomix.txt` for the map, then **open real files** for every line you report — per §4, a `high`-severity CH finding requires a pasted source snippet, and a "no importer / dead code" claim requires a confirming `Grep`. Apply the rubric. Write `docs/audits/<DATE>/code-health.md` (incl. Continuity vs the previous run if one exists). Under `audit-all`, delete nothing; standalone, the driver handles cleanup.

### Rubric

- **Dead code**: exported symbols with no importer, unreachable branches, commented-out blocks left in, unused files. (Confirm "no importer" with a `Grep` before reporting, §4.)
- **Duplication**: same logic copy-pasted across files that should be a shared util (CLAUDE.md: "Duplicated code is defect"). Prefer pointing to the existing util when one already exists (e.g. inline `cognitoId` user lookups that should call `resolveUser`; anything that should live in `shared/`).
- **Type holes**: `any`, `as any`, `@ts-ignore`/`@ts-expect-error` without justification, non-null `!` on values that can be null, untyped function boundaries.
- **Swallowed errors**: empty `catch {}`, `catch` that logs and continues where it should throw, silent fallbacks (CLAUDE.md: "Fail loudly"). Promise rejections unhandled.
- **Date/time correctness**: `new Date(dateOnlyString)` (parses as UTC midnight), date-only values stored in `DateTime`/timestamp columns, and `new Date(x).toLocaleDateString()` on values that originated as calendar dates — these shift ±1 day across timezones and are invisible when dev+tests run in one zone (NSW). Verify the construct→store→display chain uses one consistent zone.
- **Test gaps**: business-logic modules (services, route handlers, shared utils, the CSV import chain) with no corresponding test in `__tests__`/`*.test.*`. List the untested module + what it does; don't demand tests for trivial code.

Mechanical — report only what's confirmable in source. No architectural opinions. **Pure style/naming preferences** (`data`/`temp`/abbreviations, "console.error scattered", "document a convention") are NOT numbered findings — collapse them into a single `## Minor` note (schema §4). Tag confidence.
