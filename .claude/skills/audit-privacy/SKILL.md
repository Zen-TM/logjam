---
name: audit-privacy
description: Token-efficient privacy and legal/compliance audit of the Logjam codebase. Checks the project's privacy-by-design constraints (no public user-data endpoints, no coord/name leakage, explicit per-canyon sharing, no broadening export defaults) plus a Legal/Compliance section (NPWS guidance, consent flows, ToS/privacy.html wording, data retention). Uses a scoped repomix pack and a reasoning-tier subagent, writes docs/audits/<date>/privacy.md. Use when the user asks to audit privacy, data handling, sharing/export defaults, consent, legal/compliance, or run /audit-privacy.
---

# Privacy & Legal Audit

Owns: **data leak / over-share by design** + a **Legal/Compliance** section. Boundary priority below security — if a finding is an attacker-exploitable exposure, security owns it and this report cross-refs (shared §5). ID prefix `PRIV`.

Logjam is a **private** mapping/logbook app for canyoning NSW — NOT a publication platform. Privacy is a design constraint. NPWS: *"Be mindful not to publicise 'new' canyons or routes... to preserve opportunities for discovery and minimise environmental impacts."*

## Roles — read which one you are FIRST

- **Standalone** (`/audit-privacy`, you are the main agent): you are the **driver**. Do *Driver steps* — pack, then spawn ONE worker subagent to run *Execution*.
- **Under `audit-all`** (you were already spawned as the worker subagent): **you cannot spawn another subagent.** The orchestrator already created `.audit-tmp/privacy.repomix.txt`. Skip *Driver steps* — run *Execution* yourself.

## Driver steps (standalone only)

1. Read `.claude/skills/audit-shared/schema.md`.
2. Verify repomix (`npx repomix --version`; fail loud if absent). Pack (below); assert the output exists and is non-empty.
3. Spawn ONE subagent via the Agent tool — `subagent_type: general-purpose`, **no model override** (inherit reasoning tier). Hand it the pack path, the schema path, and the **Execution** section below. Tell it: write the report, do NOT spawn further subagents.
4. When it returns: report counts + path. Delete only `.audit-tmp/privacy.repomix.txt`.

Pack — `api/src/lib/**` is MANDATORY (`canyonAccess.ts` hybrid-share enforcement, `mediaPresign.ts`/`mediaOrphanSweeper.ts`/`bulkDelete.ts`/`s3Cleanup.ts` retention + S3-purge-on-delete, `logger.ts` redaction); `frontend/src/canyonUtils.ts` holds client-side data-shaping/export logic at root:
```bash
npx repomix --include "api/src/routes/**,api/src/lib/**,api/src/constants/consent.ts,api/src/services/**,frontend/src/consent.ts,frontend/src/canyonUtils.ts,frontend/src/components/**/*.tsx,frontend/public/privacy.html,frontend/public/tos.html,shared/src/**" --compress --remove-empty-lines --output ".audit-tmp/privacy.repomix.txt" --style markdown
```
consent/share/export and the legal HTML are NOT compressed-away — if `--compress` drops the HTML text, the worker must open `privacy.html`/`tos.html` raw to audit wording.

## Execution (the audit work — whoever runs it; do NOT spawn subagents)

Read `.claude/skills/audit-shared/schema.md` if you haven't (§3 format, §4 verify, §5 boundary, §6 continuity). Read the pack `.audit-tmp/privacy.repomix.txt` for the map, then **open real source/HTML files** for every line you report (§4). Apply the rubric. Write `docs/audits/<DATE>/privacy.md` (Findings + a final `## Legal / Compliance` subsection + Continuity vs the previous run if one exists). Under `audit-all`, delete nothing; standalone, the driver handles cleanup.

### Rubric

**Privacy-by-design (CLAUDE.md rules):**
- No public/unauthenticated endpoint exposes user data. Any route without auth that returns canyon/trip/media = critical.
- No analytics/telemetry leaving the user account (no third-party beacons, no coords/names sent off-account). **Explicitly inspect the analytics surface that exists** — `api/src/routes/analytics.ts` + `AnalyticsPanel.tsx` — confirm it stays on-account and emits nothing off-platform.
- **Friends routes email-omission** (CLAUDE.md): `/friends/search`, `/friends`, `/friends/requests` never return `email`. Flag any `select` on a user join in friends routes that includes `email`.
- **Redaction completeness** (cross-ref security when it's an exposure vector; own the design-consistency facet): verify `logger.ts` redact paths cover array-element / deeply-nested payload shapes (bulk import carries names at `rows[].data.name`, `trips[].name`, `displayName`/`altNames` — not matched by flat paths) and that errors logged in `middleware/errorHandler.ts` are scrubbed (Prisma `err.meta.target` / `err.message` can embed user field values that path-based redaction never reaches; `redactTilePathPatterns` exists but check it's applied there).
- **No share/export default that broadens visibility.** Sharing must be explicit, per-canyon, between authenticated users. Check `GeoPdfDialog`, `TopoExportDialog`, `CanyonDetailPanel` share UI — default scope must be private; pre-checked "share" boxes or "public" defaults = high+.
- Hybrid share model honored: shared-canyon recipients get canyon notes/media only, never per-trip notes/media/trip-list (cross-ref security if it's an enforcement bug; here, flag UI/UX that implies broader sharing than enforced).
- Logs/errors must not contain canyon coords or names in plaintext (cross-ref security when it's an exposure vector; flag here when it's a design/consistency issue).

**Legal / Compliance section:**
- `privacy.html` / `tos.html`: do they accurately describe actual data handling (S3 media, Cognito, SES email, retention)? Stale or contradictory claims = legal risk. Quote the line.
- Consent flow (`consent.ts` front + `constants/consent.ts` api): consent versioning, what's consented to, re-consent on change.
- Data retention / deletion: is there an account/canyon deletion path that actually purges S3 + DB? Orphaned media after delete = compliance gap.
- NPWS publicising risk: any feature that could surface "new" canyon locations beyond intended private sharing.

Verify by reading source/HTML. Tag confidence. No speculation.
