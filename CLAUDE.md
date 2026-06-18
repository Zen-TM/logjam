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

## Repo layout

```
api/       Express 5 + Prisma + TS — see api/CLAUDE.md
frontend/  React 19 + Vite + MapLibre + MUI — see frontend/CLAUDE.md
shared/    Cross-package types/utils (geoPdfExtent, geoPdfConfig, themeSchemes, topoSettings — canonical TOPO_LAYERS; api/frontend re-export, topo mirrors with sync comment)
topo/      Python/GDAL/PDAL MBTiles pipeline — see topo/CLAUDE.md
scripts/   One-off shell scripts (seed, snapshot)
```

**Shared rebuild rule:** after editing `shared/`, run `cd shared && npm run build` (or `make shared`) before `api`/`frontend` pick up changes. Both depend via `file:../shared` and import from `shared/dist/`. `make dev` and `make reset` invoke `make shared` automatically; manual rebuild is only needed when editing `shared/` while app dev servers are already running.

## Commands

| Pkg | Dev | Build | Test |
|---|---|---|---|
| frontend | `npm run dev` | `npm run build` (tsc + vite) | — (lint: `npm run lint`) |
| api | `npm run dev` (nodemon:8080) | `npm run build` | `npm test` (integration, needs `make dev`) |
| shared | — | `npm run build` | `npm test` (vitest) |
| root | `make dev` / `make reset` | — | — |

Prisma: `npx prisma generate` after schema change · `npx prisma migrate dev` for dev migration.

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

- **IaC = Terraform** (`infra/terraform/`, see its README). Single source of truth for prod AWS; the `envs/local` root reuses the same `storage` module for MiniStack S3 and adds `ecs.tf` (cluster + worker task defs) so MiniStack RunTask launches workers locally. All resources below were imported, not recreated. Prod root `envs/prod` (S3 backend); `terraform output` gives canonical values. RDS/Cognito/CloudFront/EB carry `prevent_destroy`. CI still owns deploys (EB env ignores `setting`; task defs ride `:latest`).
- **VPC-bound:** data-plane access needs SSM Session Manager, not SSH.
- **Elastic Beanstalk** runs API (single Docker container via `api/Dockerrun.aws.json`; image from ECR `logjam-api`).
- **ECS Fargate** runs the on-demand workers — three task defs: `logjam-topo-worker` and `logjam-topo-export-worker` (one Python image with a command override, see `topo/Dockerfile`), plus `logjam-geo-pdf-worker` (the `logjam-api` Node image with command override `node dist/worker/geoPdfWorker.js`; template `scripts/geo-pdf-worker-task-def.json`). Launched on-demand by API via the shared `api/src/lib/ecsRunTask.ts` helper (`RunTaskCommand` + placement-failure check) with a job-ID env var (`JOB_ID` / `EXPORT_JOB_ID` / `GEO_PDF_JOB_ID`). Lifecycle owned by ECS; retry semantics owned by the `TopoJob`/`TopoExportJob`/`GeoPdfJob` status columns (no SQS). Stuck jobs/exports are swept by the in-API reaper (`api/src/lib/topoJobReaper.ts`); the API stops orphaned Fargate tasks via StopTask using the persisted task ARN.
- **S3:** two buckets — `logjam-media` (photos/media) and `logjam-topo-jobs` (LiDAR ZIPs + MBTiles/PMTiles output). Presigned URLs for client upload/download. `logjam-topo-jobs` has a 7-day lifecycle rule on `exports/` (backstop; the reaper's expiry sweep is authoritative). `logjam-media` deliberately has no lifecycle rules — orphaned unconfirmed uploads are swept by the in-API reaper (`api/src/lib/mediaOrphanSweeper.ts`), which never deletes objects backed by a confirmed `Media` row.
- **CloudFront:** two distributions — `web` (E22J79PHZM2K: `logjamnsw.com`, multi-origin serving the frontend SPA bucket + topo tiles from `logjam-topo-jobs` under `/master/*`; this is `TOPO_CDN_BASE_URL=https://logjamnsw.com`) and `api` (E29GLTTDM6CXX4: `api.logjamnsw.com`, fronts the EB API).
- **Resend** for transactional email on job/export/GeoPDF completion (replaced AWS SES, whose production access was denied). API key in Secrets Manager (`logjam/resend-api-key`), injected into the three worker task defs as `RESEND_API_KEY`; sender `EMAIL_FROM=noreply@notifications.logjamnsw.com`. Node side: `api/src/services/email.ts` (`sendEmail`); Python workers: `topo/email_send.py`. Sends are best-effort (no-op if key unset); the in-app `Notification` row is the source of truth.
- **Cognito** user pool; API verifies JWT via JWKS.
- **ECR** image registry (`logjam-api`, `logjam-topo-worker`).

### AWS one-liners (always `--profile logjam --region ap-southeast-2`)

```bash
# Logs
aws logs tail /ecs/<service> --follow --profile logjam

# ECS task state
aws ecs describe-tasks --cluster <cluster> --tasks <task-arn> --profile logjam
aws ecs list-tasks --cluster <cluster> --profile logjam

# SSM into a running task
aws ecs execute-command --cluster <cluster> --task <task-arn> \
  --container <name> --interactive --command "/bin/sh" --profile logjam

# S3 listing
aws s3 ls s3://<bucket>/ --profile logjam
```

## Data model

Core Prisma entities: `User` (Cognito-linked) · `Canyon` · `TripLog` · `Media` (S3) · `Friendship` · `CanyonShare` · `TopoJob` · `TopoExportJob` · `Notification` · `GeoPdfTemplate`. Schema: `api/prisma/schema.prisma`.

## Conventions (self-updating)

On user correction or non-obvious pattern confirmation, **immediately ask** "Save this to CLAUDE.md?" before continuing. If approved, append below with one-line rationale. End-of-turn: list other patterns noticed for batch confirm.

Additive only. Never silently delete existing conventions — flag stale entries for user review.

- **Canyon share visibility (hybrid model):** `CanyonShare` recipients see the canyon record including canyon-level `notes` and canyon-level `media`. Per-trip `notes`, per-trip `media`, and the trip log list are owner-private. Single source of the access decision: `api/src/lib/canyonAccess.ts` (`getCanyonRole` / `requireCanyonAccess` / `requireCanyonOwnerAccess` / `requireCanyonOwner`) — used by `api/src/routes/canyons.ts` (GET/PATCH/DELETE `/:id`, POST `/:id/copy`), `api/src/routes/sharing.ts` (POST `/:id/share`, GET `/:id/shares`), and `api/src/routes/tripLogs.ts` (GET `/`, GET `/:id`). Any new endpoint on shared canyons must derive its decision from these helpers, not inline owner/share checks.
  - **404-not-403 anti-oracle:** no-access (`role === "none"`) on a canyon resource returns **404**, never 403, so the status can't confirm a canyon ID exists to someone who can't see it. Owner-only actions a *sharee* attempts return **403** (they legitimately see the canyon, just lack the permission). `requireCanyonAccess` (read) and `requireCanyonOwnerAccess` (owner-only mutations) bake this in. Known remaining 403 oracles on canyon ids — `routes/media.ts` attach + `routes/canyonsBulk.ts` foreign id — are separate surfaces, documented follow-ups.
- **Friend search and lists are username-only:** `/friends/search`, `/friends`, and `/friends/requests` never return `email`. Drop `email` from any `select` on user joins in the friends routes.
- **Topo export legality has one source:** `reconcileExportSelection` / `validateExportRequest` in `shared/src/topoExport.ts`. New export surfaces (dialogs, auto-export, reaper) call these — never re-derive format/bundling/layer rules.
- **Reaper-driven auto-queued jobs dedup via a status-guarded `*-At` claim column:** flip the marker (e.g. `TopoJob.autoExportedAt`) null→now in one `updateMany` and only act when it flips exactly one row, so overlapping sweeps / multiple API instances can't double-queue. See `queueAutoExports` in `api/src/lib/topoJobReaper.ts`.

## Testing

Tests exist but not gating. Recommend, don't require. Run before committing structural changes.

### How to run

| Suite | Command | Needs |
|---|---|---|
| `shared` unit | `cd shared && npm test` (vitest) | nothing |
| `api` unit | `cd api && npm run test:unit` (vitest, `*.unit.test.ts`, Prisma/AWS mocked) | nothing — no server/DB |
| `api` integration | `cd api && npm test` (vitest, `src/__tests__/`) | running local API (`make dev` first) |
| `frontend` unit | `cd frontend && npm test` (vitest, jsdom) | nothing |
| `topo` unit | `cd topo && python -m unittest discover -s tests` | host runs pure logic; GDAL/PDAL paths skip on host, run in worker Docker image |

Two kinds of `api` test, kept separate: `*.unit.test.ts` (colocated with source, no infra) vs `src/__tests__/*.test.ts` (integration, hits live API). `npm run test:unit` must pass with **no** `make dev` running — if it needs a server, it's misfiled.

**Multi-user integration tests:** fake auth honors an `x-fake-sub` request header (dev only; impossible outside `AUTH_MODE=fake` because it lives inside that branch, guarded fail-closed at module load in `api/src/middleware/auth.ts`) so one test process can act as any seeded user per request. Use the helper `api/src/__tests__/_actors.ts` — `as(BOB_SUB)` / `as(CAROL_SUB)` spread onto a supertest `.set(...)`; no header = alice (unchanged). The seed (alice/bob/carol with friendships + shares) supports sharee/stranger-perspective tests — see `src/__tests__/shareBoundary.test.ts` (the SEC-001 regression from the recipient side, which mocked-Prisma unit tests can't reach). Note: the integration suite hits the in-process `globalLimiter` (300 req/user/60s) — running it in a tight loop trips 429s; let the window drain or restart the API between back-to-back runs.

**Committed fixtures convention:** small canned inputs live in a `__fixtures__/` dir beside their test (e.g. `api/src/services/__fixtures__/sample.mvt` for the vector-tile decode test, regenerable by hand-encoding via `pbf`). Use this for fixture-based parser/decoder tests instead of inlining large blobs.

`topo` pure-logic tests import `tests/_native_stub.py` first, which stubs `osgeo`/`psycopg2`/etc when absent (dev host) so they run in CI; inside Docker the real libs import and the stub is a no-op. A test that exercises a real native lib must skip when stubbed (see `tests/test_tile_compose.py` for GDAL; `tests/test_status_guard_db.py` for the real-Postgres ARCH-001 resurrection invariant, gated on `RUN_DB_IT=1` + real `psycopg2`). Cross-language constant drift is guarded by `tests/test_layer_sync.py` (TS `TOPO_LAYERS` ↔ Python `ALL_LAYERS`). Heavier worker integration runbooks: `topo/tests/INTEGRATION.md`. Real-Cognito auth-lifecycle E2E: `frontend/e2e/auth-lifecycle.spec.ts` (env-gated on a staging pool).

### What to test when adding code

Write pure unit tests for the logic, not the plumbing. Prioritise:
- **Privacy/security boundaries** (mandatory — see privacy rules above): share-visibility filters, email-omission, log redaction (`api/src/lib/logger.ts`), error-detail whitelist (`api/src/middleware/errorHandler.ts`), auth fail-closed guards. A new endpoint touching shared canyons or user data deserves a test that the boundary holds.
- **Pure transforms & parsers:** anything that maps/validates/parses input → output with branches (CSV import chain, RopeWiki parsers, coordinate/extent math, quota arithmetic, config validators). Highest value, cheapest to test.
- **State machines / lifecycle:** job status transitions, reaper cutoffs, dedupe tier assignment.

Don't unit-test: thin Prisma/AWS pass-through route handlers (covered by integration tests), MapLibre/MUI rendering, GDAL/PDAL subprocess orchestration. When logic is tangled with Prisma/AWS/MapLibre, extract the pure part and test that. Mock Prisma via `vi.mock("../services/prisma")`, AWS via the `@aws-sdk/*` module; never hit a real service in a unit test.

## README updates

Touch `README.md` only when user-facing setup changes (commands, env vars, install steps). Skip internal refactors. Per-subdir READMEs (`topo/README.md`) follow same rule.

## Working style

Project-specific rules only; general engineering practices live in `~/.claude/CLAUDE.md`. When in doubt on Logjam-specific convention, ask before writing code.