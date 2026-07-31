---
name: audit-security
description: Token-efficient security audit of the Logjam codebase. Scans api + topo attack surface (authz, injection, SSRF, secrets, presigned URLs, subprocess/path handling) using a scoped repomix pack and a reasoning-tier subagent, then writes docs/audits/<date>/security.md. Use when the user asks to audit security, find vulnerabilities, review attack surface, or run /audit-security. Owns attacker-can-do-X findings (highest boundary priority).
---

# Security Audit

Owns: **"can an attacker do X"** — authz bypass, injection, SSRF, secret exposure, presigned-URL scope, subprocess/path traversal, JWT/Cognito verification. Highest boundary priority (see shared §5). ID prefix `SEC`.

## Roles — read which one you are FIRST

- **Standalone** (`/audit-security`, you are the main agent): you are the **driver**. Do *Driver steps* — pack, then spawn ONE worker subagent to run *Execution*, so the work stays out of your context.
- **Under `audit-all`** (you were already spawned as the worker subagent): **you cannot spawn another subagent.** The orchestrator already created `.audit-tmp/security.repomix.txt`. Skip *Driver steps* — run *Execution* yourself.

## Driver steps (standalone only)

1. Read `.claude/skills/audit-shared/schema.md`.
2. Verify repomix (`npx repomix --version`; fail loud if absent). Pack (below); assert the output exists and is non-empty.
3. Spawn ONE subagent via the Agent tool — `subagent_type: general-purpose`, **no model override** (inherit reasoning tier; do not downgrade to haiku). Hand it the pack path, the schema path, and the **Execution** section below. Tell it: write the report, do NOT spawn further subagents.
4. When it returns: report counts by severity + the path (don't restate every finding). Delete only `.audit-tmp/security.repomix.txt`.

Pack — `api/src/lib/**` and `api/src/worker/**` are MANDATORY (the authz/security core: `canyonAccess.ts`, `mediaPresign.ts`, `mediaUploadValidation.ts`, `ecsRunTask.ts`, `logger.ts`, `resolveUser.ts`, `dbPassword.ts`/`resolveDbCredentials.ts`, `topoExportLauncher.ts`, the Node `geoPdfWorker.ts`); without them the rubric below cannot be satisfied:
```bash
npx repomix --include "api/src/routes/**,api/src/middleware/**,api/src/services/**,api/src/lib/**,api/src/worker/**,api/src/constants/**,api/prisma/schema.prisma,topo/**/*.py,shared/src/**" --compress --remove-empty-lines --output ".audit-tmp/security.repomix.txt" --style markdown
```

## Execution (the audit work — whoever runs it; do NOT spawn subagents)

Read `.claude/skills/audit-shared/schema.md` if you haven't (finding format §3, verify-before-write §4, boundary §5, continuity §6). Read the pack `.audit-tmp/security.repomix.txt` for the map, then **open real source files** for every line you report (§4). Apply the rubric. Write `docs/audits/<DATE>/security.md` in the shared schema, including the Continuity section vs the previous run's `security.md` if one exists (§6). Under `audit-all`, delete nothing; standalone, the driver handles cleanup.

### Rubric

Check, with Logjam context (private canyoning app; auth via Cognito JWT, `AUTH_MODE=fake` dev only):

- **AuthZ**: every route under `api/src/routes` enforces ownership / share boundary, derived from `api/src/lib/canyonAccess.ts` helpers (not inline owner checks). Cross-check the CLAUDE.md hybrid share model — `CanyonShare` recipients see canyon notes/media but NOT per-trip notes/media/trip-list. Any GET on a shared resource leaking owner-private data = high+.
- **404-not-403 anti-oracle** (CLAUDE.md): no-access on a canyon resource returns **404**, never 403, so status can't confirm a canyon ID exists to someone who can't see it. Flag any canyon-id route that 403s (or otherwise distinguishes exists-but-forbidden from not-found) for a non-sharee — known remaining oracles: `routes/media.ts` attach + `routes/canyonsBulk.ts` foreign id; confirm no new ones.
- **AuthN**: JWT/JWKS verification correct; `AUTH_MODE=fake` cannot activate when `NODE_ENV=production` (fail-closed at module load in `middleware/auth.ts`); the `x-fake-sub` test header MUST be unreachable outside the `AUTH_MODE=fake` branch; no auth bypass paths.
- **Reaper / dedup integrity**: status-guarded claim columns (e.g. `TopoJob.autoExportedAt` null→now via one `updateMany`) actually prevent double-queue across overlapping sweeps / multiple API instances — a race here is a real bug.
- **Injection**: raw SQL / Prisma `$queryRaw` with interpolation; command injection in topo subprocess (PDAL/GDAL calls); unsanitized path joins (path traversal on S3 keys or local files).
- **SSRF / presigned URLs**: presigned S3 URLs scoped to one key, short TTL, no user-controlled bucket/key without validation. Any user-supplied URL fetched server-side.
- **Secrets**: hardcoded keys/tokens, secrets in error messages or logs, `.env` values echoed.
- **Data exposure in logs**: canyon coords/names in plaintext logs or error responses (CLAUDE.md privacy rule — this is security-owned when it's an exposure vector).
- **Input validation**: request bodies validated before use; mass-assignment via spread into Prisma `create`/`update`.
- **Resource-exhaustion / input limits**: every endpoint accepting an array or doing per-element work must cap collection length **explicitly** (not just `express.json` byte limit) — bulk import (`canyonsBulk.ts`, `tripLogsBulk.ts`) currently checks only `length === 0` while bulk *delete* has a limit; that asymmetry is the bug pattern. Expensive endpoints (bulk import, RopeWiki scrape, render) need a dedicated rate limiter, not just the 300/min `globalLimiter`.
- **Response-header construction**: user-controlled values interpolated into response headers (e.g. `Content-Disposition` filename in `mediaPresign.ts`) must strip CRLF/control chars, not just quotes.
- **Topo worker**: `JOB_ID` / env trust boundary, ZIP extraction (zip-slip — `_safe_extract_zip`/`isUnsafeZipEntryName`), arbitrary file write from LiDAR payloads.

Severity by real exploitability. Tag confidence. Cross-ref deps-owned CVEs rather than restating.
