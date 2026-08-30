# CLAUDE.md — Logjam Root

Guidance for Claude Code in this repo. Sub-CLAUDE.md in `frontend/`, `api/`, `topo/` cover stack rules.

## Context

Logjam = **private** mapping/logbook app for canyoning NSW. **Not** publication platform. Privacy = design constraint, not feature.

> "Be mindful not to publicise 'new' canyons or routes, particularly those in wilderness areas, to preserve opportunities for discovery and to minimise environmental impacts." — NSW NPWS

**Privacy rules (enforce every new feature):**
- No public/unauth endpoints on user data.
- No analytics/telemetry leaving user account.
- No share/export defaults broadening visibility — sharing explicit, per-canyon, between auth'd users.
- Logs/errors must not contain canyon coords or names in plain text.

**Shared rebuild rule:** after editing `shared/`, run `cd shared && npm run build` (or `make shared`) before `api`/`frontend` pick up changes. Both depend via `file:../shared` and import from `shared/dist/`. `make dev` and `make reset` invoke `make shared` automatically; manual rebuild is only needed when editing `shared/` while app dev servers are already running.

## Environments — never confuse

| Env | Trigger | Auth | DB | AWS |
|---|---|---|---|---|
| **Local dev** | `make dev` + `.env.local` | `AUTH_MODE=fake`, seeded user (alice) | Local Postgres in docker | MiniStack via `AWS_ENDPOINT_URL` (S3 + ECS RunTask: workers run as real local containers) |
| **Prod** | deployed to AWS (EB runs API, ECS runs workers) | Cognito JWT | RDS | Real AWS, profile `logjam`, region `ap-southeast-2` |

**Hard rules:**
- Never run prod-targeted commands without explicit user confirmation.
- `AUTH_MODE=fake` throws if `NODE_ENV=production` (see `api/src/middleware/auth.ts`) — don't weaken.
- `api/.env` prod-style and gitignored; `.env.local` at root = dev file.

## AWS architecture

Prod runs on Elastic Beanstalk (API) + ECS Fargate (workers) + S3 + CloudFront + Cognito, IaC'd in `infra/terraform/`. All AWS CLI calls use `--profile logjam --region ap-southeast-2`. Full topology, task-def/bucket/distribution details, and CLI one-liners: the **aws-architecture** skill.

## Conventions (self-updating)

On user correction or non-obvious pattern confirmation, **immediately ask** "Save this to CLAUDE.md?" before continuing. If approved, append below with one-line rationale. End-of-turn: list other patterns noticed for batch confirm.

Additive only. Never silently delete existing conventions — flag stale entries for user review.

- **Canyon share visibility (hybrid model):** `CanyonShare` recipients see the canyon record including canyon-level `notes` and canyon-level `media`. Per-trip `notes`, per-trip `media`, and the trip log list are owner-private. Single source of the access decision: `api/src/lib/canyonAccess.ts` (`getCanyonRole` / `requireCanyonAccess` / `requireCanyonOwnerAccess` / `requireCanyonOwner`) — used by `api/src/routes/canyons.ts` (GET/PATCH/DELETE `/:id`, POST `/:id/copy`), `api/src/routes/sharing.ts` (POST `/:id/share`, GET `/:id/shares`), and `api/src/routes/tripLogs.ts` (GET `/`, GET `/:id`). Any new endpoint on shared canyons must derive its decision from these helpers, not inline owner/share checks.
  - **404-not-403 anti-oracle:** no-access (`role === "none"`) on a canyon resource returns **404**, never 403, so the status can't confirm a canyon ID exists to someone who can't see it. Owner-only actions a *sharee* attempts return **403** (they legitimately see the canyon, just lack the permission). `requireCanyonAccess` (read) and `requireCanyonOwnerAccess` (owner-only mutations) bake this in. Known remaining 403 oracles on canyon ids — `routes/media.ts` attach + `routes/canyonsBulk.ts` foreign id — are separate surfaces, documented follow-ups.
  - **Owner-private extends to derived cardinality, not just the rows.** A count/aggregate of owner-private data (trip tally, share fan-out) is itself owner-private — withholding the trip *list* while shipping its `_count` is not a boundary. A sharee-reachable payload must not carry `_count`/sum/exists over owner-private relations; scope it to the owned response (see `canyonListInclude` in `api/src/routes/canyons.ts`, `canyonsList.unit.test.ts`). A test that asserts the *list* is withheld will pass while its count leaks — assert the aggregate's absence too.
- **Friend search and lists are username-only:** `/friends/search`, `/friends`, and `/friends/requests` never return `email`. Drop `email` from any `select` on user joins in the friends routes.
- **Topo export legality has one source:** `reconcileExportSelection` / `validateExportRequest` in `shared/src/topoExport.ts`. New export surfaces (dialogs, auto-export, reaper) call these — never re-derive format/bundling/layer rules.
- **Trip titles have one derivation:** `displayName` (user override) `?? formatTripCanyonNames(linked canyon names, join-position order)` (`shared/src/tripName.ts`) `?? "Untitled trip"` — frontend via `tripTitle()` in `frontend/src/canyonUtils.ts`. Never inline the name join or store a derived title; `displayName` stays null until the user edits it (the only exception: canyon-delete paths backfill `displayName` on trips losing their last linked canyon, so they keep a label).
- **Reaper-driven auto-queued jobs dedup via a status-guarded `*-At` claim column:** flip the marker (e.g. `TopoJob.autoExportedAt`) null→now in one `updateMany` and only act when it flips exactly one row, so overlapping sweeps / multiple API instances can't double-queue. See `queueAutoExports` in `api/src/lib/topoJobReaper.ts`.
- **A bare `Error` from a service renders as a generic 500.** `errorHandler` only echoes a real status/message for `AppError`; anything else becomes "Internal server error". So an upstream or infra failure thrown as `new Error(...)` reaches the user as an apparent app crash with nothing to act on — that is how RopeWiki's Cloudflare 403 presented (2026-08-30): prod logged `unhandled_error`, the client saw a 500, and the actual cause was a third party blocking us. Throw `AppError` with a status that names the layer: 502 upstream refused, 503 a dependency we own is missing. Guard: `api/src/services/ropeWikiCache.unit.test.ts` asserts the 502/503 statusCodes rather than just that it throws.
- **Parser fixtures are the source's real output, not a tidied version of it.** The RopeWiki parser tests passed for months against synthetic CSV with lowercase headers and clean cells, while the live export sends `PAGEID`, `15r`, `229.659 ft` and HTML-wrapped ratings — none of that was covered, so a header-casing regression would have shipped green. Commit a few real rows under `__fixtures__/` and parse those too (`api/src/services/__fixtures__/ropewiki-nsw-sample.csv`).
- **An external data source can be withdrawn without notice.** RopeWiki went behind a Cloudflare managed challenge that 403s every non-browser client on every path regardless of User-Agent (2026-08-30) — no header or retry fixes it, and their own robots.txt still permits us, so the block is WAF config disagreeing with stated policy. Slow-changing third-party corpora are held as a hand-refreshed S3 snapshot (`reference/` in the media bucket, read by `getRopeWikiCanyons`), with the live fetch kept behind `?fresh=true` so re-enabling it is a default, not a rebuild.

## Testing

Integration suites (`api` `npm test`, topo Docker runbooks) are **NOT** in CI — run them locally before committing changes they cover. Everything else (unit suites, lint, typecheck) gates PRs via `.github/workflows/ci.yml`.

### How to run

| Suite | Command | Needs |
|---|---|---|
| `shared` unit | `cd shared && npm test` (vitest) | nothing |
| `api` unit | `cd api && npm run test:unit` (vitest, `*.unit.test.ts`, Prisma/AWS mocked) | nothing — no server/DB |
| `api` integration | `cd api && npm test` (vitest, `src/__tests__/`) | running local API (`make dev` first) |
| `frontend` unit | `cd frontend && npm test` (vitest, jsdom) | nothing |
| `topo` unit | `cd topo && python -m unittest discover -s tests` | host runs pure logic; GDAL/PDAL paths skip on host, run in worker Docker image |

Two kinds of `api` test, kept separate: `*.unit.test.ts` (colocated with source, no infra) vs `src/__tests__/*.test.ts` (integration, hits live API). `npm run test:unit` must pass with **no** `make dev` running — if it needs a server, it's misfiled.

**Multi-user integration tests:** fake auth honors an `x-fake-sub` request header (dev only; impossible outside `AUTH_MODE=fake` because it lives inside that branch, guarded fail-closed at module load in `api/src/middleware/auth.ts`) so one test process can act as any seeded user per request. Use the helper `api/src/__tests__/_actors.ts` — `as(BOB_SUB)` / `as(CAROL_SUB)` spread onto a supertest `.set(...)`; no header = alice (unchanged). The seed (alice/bob/carol with friendships + shares) supports sharee/stranger-perspective tests — see `src/__tests__/shareBoundary.test.ts` (the SEC-001 regression from the recipient side, which mocked-Prisma unit tests can't reach). Note: the integration suite hits the in-process `globalLimiter` (300 req/**60s, keyed per-IP** — it mounts before `requireAuth`, so `userOrIpKey` always falls back to IP and all actors share ONE budget; "per-user" only applies to authed keying it never reaches). The suite runs files sequentially (`fileParallelism: false`) and `__tests__/_rateLimitGate.ts` sleeps to the window reset when `RateLimit-Remaining` runs low, so back-to-back runs self-throttle instead of 429ing.

**Committed fixtures convention:** small canned inputs live in a `__fixtures__/` dir beside their test (e.g. `api/src/services/__fixtures__/sample.mvt` for the vector-tile decode test, regenerable by hand-encoding via `pbf`). Use this for fixture-based parser/decoder tests instead of inlining large blobs.

`topo` pure-logic tests import `tests/_native_stub.py` first, which stubs `osgeo`/`psycopg2`/etc when absent (dev host) so they run in CI; inside Docker the real libs import and the stub is a no-op. A test that exercises a real native lib must skip when stubbed (see `tests/test_tile_compose.py` for GDAL; `tests/test_status_guard_db.py` for the real-Postgres ARCH-001 resurrection invariant, gated on `RUN_DB_IT=1` + real `psycopg2`). Cross-language constant drift is guarded by `tests/test_layer_sync.py` (TS `TOPO_LAYERS` ↔ Python `ALL_LAYERS`). Heavier worker integration runbooks: `topo/tests/INTEGRATION.md`. Real-Cognito auth-lifecycle E2E: `frontend/e2e/auth-lifecycle.spec.ts` (env-gated on a staging pool).

### What to test when adding code

- **Privacy/security boundaries are mandatory** (see privacy rules above): share-visibility filters, email-omission, log redaction (`api/src/lib/logger.ts`), error-detail whitelist (`api/src/middleware/errorHandler.ts`), auth fail-closed guards. A new endpoint touching shared canyons or user data deserves a test that the boundary holds.
- **Don't unit-test:** thin Prisma/AWS pass-through route handlers (covered by integration tests), MapLibre/MUI rendering, GDAL/PDAL subprocess orchestration. When logic is tangled with Prisma/AWS/MapLibre, extract the pure part and test that.
- Mock Prisma via `vi.mock("../services/prisma")`, AWS via the `@aws-sdk/*` module; never hit a real service in a unit test.

## README updates

Touch `README.md` only when user-facing setup changes (commands, env vars, install steps). Skip internal refactors. Per-subdir READMEs (`topo/README.md`) follow same rule.

When in doubt on a Logjam-specific convention, ask before writing code.