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
| **Local dev** | `make dev` + `.env.local` | `AUTH_MODE=fake`, seeded user (alice) | Local Postgres in docker | LocalStack via `AWS_ENDPOINT_URL` |
| **Prod** | deployed to AWS (EB runs API, ECS runs workers) | Cognito JWT | RDS | Real AWS, profile `logjam`, region `ap-southeast-2` |

**Hard rules:**
- Never run prod-targeted commands without explicit user confirmation.
- `AUTH_MODE=fake` throws if `NODE_ENV=production` (see `api/src/middleware/auth.ts`) — don't weaken.
- `api/.env` prod-style and gitignored; `.env.local` at root = dev file.

## AWS architecture

- **IaC = Terraform** (`infra/terraform/`, see its README). Single source of truth for prod AWS; same `storage` module provisions LocalStack S3 for dev. All resources below were imported, not recreated. Prod root `envs/prod` (S3 backend); `terraform output` gives canonical values. RDS/Cognito/CloudFront/EB carry `prevent_destroy`. CI still owns deploys (EB env ignores `setting`; task defs ride `:latest`).
- **VPC-bound:** data-plane access needs SSM Session Manager, not SSH.
- **Elastic Beanstalk** runs API (single Docker container via `api/Dockerrun.aws.json`; image from ECR `logjam-api`).
- **ECS Fargate** runs the topo workers — two task defs: `logjam-topo-worker` and `logjam-topo-export-worker` (one Python image with a command override, see `topo/Dockerfile`). Launched on-demand by API via the shared `api/src/lib/ecsRunTask.ts` helper (`RunTaskCommand` + placement-failure check) with a job-ID env var (`JOB_ID` / `EXPORT_JOB_ID`). Lifecycle owned by ECS; retry semantics owned by the `TopoJob`/`TopoExportJob` status columns (no SQS). Stuck jobs/exports are swept by the in-API reaper (`api/src/lib/topoJobReaper.ts`); the API stops orphaned Fargate tasks via StopTask using the persisted task ARN.
- **Lambda** runs the GeoPDF render — `logjam-geo-pdf-worker`, a container-image function reusing the `logjam-api` ECR image with the entry_point overridden to the AWS Lambda Runtime Interface Client and command `dist/worker/geoPdfLambda.handler` (`infra/terraform/envs/prod/lambda.tf`). VPC-attached for RDS; resolves DB creds from `DB_SECRET_ID` at startup (`api/src/lib/resolveDbCredentials.ts`). POST `/geo-pdf` async-invokes it (`InvocationType: "Event"`) via `api/src/lib/lambdaInvoke.ts` passing `GEO_PDF_JOB_ID`; the handler delegates to the shared `processGeoPdfJob` lifecycle in `api/src/worker/geoPdfWorker.ts`. Retry semantics owned by the `GeoPdfJob` status column. Stuck jobs swept by the same reaper, which marks them failed but does NOT StopTask (no task handle — the orphaned Lambda self-cleans via its status-guarded terminal write). The retained `logjam-geo-pdf-worker` ECS task def is superseded (kept one transition cycle, see `ecs.tf`).
- **S3:** two buckets — `logjam-media` (photos/media) and `logjam-topo-jobs` (LiDAR ZIPs + MBTiles/PMTiles output). Presigned URLs for client upload/download. `logjam-topo-jobs` has a 7-day lifecycle rule on `exports/` (backstop; the reaper's expiry sweep is authoritative). `logjam-media` deliberately has no lifecycle rules — orphaned unconfirmed uploads are swept by the in-API reaper (`api/src/lib/mediaOrphanSweeper.ts`), which never deletes objects backed by a confirmed `Media` row.
- **CloudFront:** two distributions — `web` (E22J79PHZM2K: `logjamnsw.com`, multi-origin serving the frontend SPA bucket + topo tiles from `logjam-topo-jobs` under `/master/*`; this is `TOPO_CDN_BASE_URL=https://logjamnsw.com`) and `api` (E29GLTTDM6CXX4: `api.logjamnsw.com`, fronts the EB API).
- **SES** for transactional email on topo job completion (region: `COGNITO_REGION` if set).
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

- **Canyon share visibility (hybrid model):** `CanyonShare` recipients see the canyon record including canyon-level `notes` and canyon-level `media`. Per-trip `notes`, per-trip `media`, and the trip log list are owner-private. Single source of the access decision: `api/src/lib/canyonAccess.ts` (`getCanyonRole` / `requireCanyonAccess` / `requireCanyonOwner`) — used by `api/src/routes/canyons.ts` (GET `/:id`, POST `/:id/copy`) and `api/src/routes/tripLogs.ts` (GET `/`, GET `/:id`). Any new endpoint on shared canyons must derive its decision from these helpers, not inline owner/share checks.
- **Friend search and lists are username-only:** `/friends/search`, `/friends`, and `/friends/requests` never return `email`. Drop `email` from any `select` on user joins in the friends routes.

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

`topo` pure-logic tests import `tests/_native_stub.py` first, which stubs `osgeo` when it's absent (dev host) so they run in CI; inside Docker the real GDAL imports and the stub is a no-op. A test that exercises real GDAL/PDAL must skip when `_native_stub.is_stubbed("osgeo")` (see `tests/test_tile_compose.py`).

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