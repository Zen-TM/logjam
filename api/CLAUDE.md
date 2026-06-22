# API — Logjam

Express 5 + Prisma + TypeScript REST backend. Port 8080 dev.

## Codebase nav

```
src/
  index.ts                 app bootstrap, route registration, error handler last
  middleware/
    auth.ts                requireAuth — Cognito JWT verify, AUTH_MODE=fake bypass (honors x-fake-sub header to switch acting user, fake mode only — see __tests__/_actors.ts)
    errorHandler.ts        AppError class + handler
  services/
    prisma.ts              singleton PrismaClient built on @prisma/adapter-pg (Prisma 7 driver adapter; default export)
    awsClients.ts          s3/ecs/cognitoIdp singletons (emulator-aware via AWS_ENDPOINT_URL → MiniStack in dev). No SQS — topo jobs launch via ECS RunTask; retry is owned by the TopoJob.status column.
    email.ts               Resend transactional send helper (sendEmail; no-op if RESEND_API_KEY/EMAIL_FROM unset). Used by geoPdfWorker; Python workers send via topo/email_send.py.
    ropewiki.ts            external scraper
    generateGeoPdf.ts      GeoPDF rendering
  lib/                     cross-route building blocks — prefer these over inline logic
    env.ts                 zod-validated env, getEnv() (cached) — single source of env truth
    resolveUser.ts         cognitoId → User row (auth boilerplate)
    canyonAccess.ts        hybrid-share access decision (getCanyonRole / requireCanyonAccess / requireCanyonOwner)
    ecsRunTask.ts          shared RunTask launch + placement-failure check
    topoJobReaper.ts       periodic sweeps: stuck jobs/exports, export expiry, media orphans
    mediaOrphanSweeper.ts  deletes unconfirmed media/ S3 objects with no Media row
    mediaUploadValidation.ts  presign size caps (SEC-003)
    storageQuota.ts / tileQuota.ts  tx-aware quota arithmetic
    s3Cleanup.ts           batch S3 key deletion (strict + best-effort)
    logger.ts              pino + redaction (no coords/names in logs)
  routes/                  one file per resource; registered in index.ts
  constants/               server-side enums (e.g. topoLayers — re-exports shared/src/topoSettings)
  types/                   shared request/response types
  __tests__/               integration tests (need running local API)
prisma/schema.prisma       data model
prisma.config.ts           Prisma 7 config: datasource URL + seed command (replaces schema datasource.url and package.json#prisma.seed)
```

**Canonical examples:**
- Route file w/ auth + AppError + Prisma: `routes/canyons.ts`.
- Route w/ AWS SDK (S3 presign + ECS task launch): `routes/topoJobs.ts`. Tasks launch via `lib/ecsRunTask.ts`, which inspects the RunTask response's `.failures[]` and force-fails the job if placement fails (no SQS in this architecture) — don't call `RunTaskCommand` directly in routes.
- User resolution: `resolveUser(sub)` from `lib/resolveUser.ts` (see its docstring; GET /users/me is the deliberate exception). Ownership checks: filter by `ownerId` / verify via join — see `routes/topoJobs.ts`.

## Hard rules

### Auth on every route

Every route except `/health` use `requireAuth`. Access `req.user!.sub` (Cognito ID). Resolve to internal user:

```ts
import { resolveUser } from "../lib/resolveUser";
const user = await resolveUser(req.user!.sub); // throws AppError(404) if no row
```

Never re-declare an inline `prisma.user.findUnique({ where: { cognitoId } })` lookup — that duplication is what `resolveUser` exists to kill (CH-001).

**Ownership check mandatory** for any read/write on user-owned entities. Filter by `ownerId: user.id` or verify via join (`shares: { some: { sharedWithId: user.id } }`). Never trust ID from request body without ownership check.

### Errors via AppError

```ts
import { AppError } from "../middleware/errorHandler";
throw new AppError(404, "Canyon not found");
```

Never `res.status(500).json(...)` direct. Global handler catches `AppError` + unknown. Don't catch + swallow — let throw.

### Prisma singleton

```ts
import prisma from "../services/prisma";
```

Never `new PrismaClient()` in route. Singleton handles connection pooling + dev-mode query logging. Prisma 7 requires a driver adapter at construction — `services/prisma.ts` builds it from `@prisma/adapter-pg` + a connection string composed from `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` via `lib/databaseUrl.ts` (`databaseUrlFromEnv()`, fails loud if any are unset); a bare `new PrismaClient()` won't connect.

### AWS SDK v3

Import clients from `services/awsClients.ts`:

```ts
import { s3, ecs, cognitoIdp } from "../services/awsClients";
```

Client factory honors `AWS_ENDPOINT_URL` for the local emulator (MiniStack) — never construct `S3Client` inline. Region defaults to `AWS_REGION` (`ap-southeast-2`). Transactional email is NOT AWS — see `services/email.ts` (Resend).

Commands imported per-call from `@aws-sdk/client-*`:

```ts
import { PutObjectCommand } from "@aws-sdk/client-s3";
await s3.send(new PutObjectCommand({ Bucket, Key, Body }));
```

### Env vars

All env is zod-validated at boot by `lib/env.ts` — read values via `getEnv()`, never raw `process.env` in routes/libs. Schema in `env.ts` is the source of truth for the var LIST (defaults, prod-required checks, reaper/TTL knobs like `TOPO_REAPER_*_MS`, `TOPO_EXPORT_TTL_MS`, `MEDIA_ORPHAN_TTL_MS` — all sweep knobs accept 0 = disabled). Add new vars to the schema, not ad-hoc reads. Local-dev VALUES are generated by Terraform: the root `.env.local` is rendered by `infra/terraform/envs/local` (via `make dev`/`make reset`) from `infra/terraform/templates/env.local.tftpl` — so a new dev var goes in BOTH `env.ts` and that template. Prod values are injected by EB (`.ebextensions`) + the ECS task defs (now Terraform-managed); `cd infra/terraform/envs/prod && terraform output` is the canonical prod reference. Core set:

| Var | Purpose |
|---|---|
| `DB_HOST`, `DB_PORT` (default 5432), `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Postgres connection parts, composed into a connection string by `lib/databaseUrl.ts`. ECS workers get `DB_USER`/`DB_PASSWORD` via ECS secrets injection from the RDS-managed Secrets Manager secret; the EB API container resolves them from `DB_SECRET_ID` at boot (`src/boot.ts`). |
| `DB_SECRET_ID` | Secrets Manager secret id/ARN, used only by `src/boot.ts` (EB container) to populate `DB_USER`/`DB_PASSWORD` before `getEnv()` runs |
| `COGNITO_REGION`, `COGNITO_USER_POOL_ID` | JWT verification |
| `COGNITO_CLIENT_ID` | JWT `aud` check (ID token) — required when `AUTH_MODE=cognito` |
| `AUTH_MODE` | `fake` for local dev; throws if `production` |
| `FAKE_USER_SUB` | local seeded user |
| `AWS_REGION` | `ap-southeast-2` |
| `AWS_ENDPOINT_URL` | local emulator (MiniStack) only |
| `S3_BUCKET_TOPO`, `S3_BUCKET_MEDIA` | topo pipeline / media uploads |
| `ECS_CLUSTER`, `ECS_TOPO_TASK_DEF`, `ECS_TOPO_EXPORT_TASK_DEF`, `ECS_SUBNETS`, `ECS_SECURITY_GROUPS` | worker launches |
| `CORS_ORIGIN` | comma-separated allowed origins; `*` if unset |

## Route template

```ts
import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { resolveUser } from "../lib/resolveUser";

const router = Router();

router.get("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = await resolveUser(req.user!.sub);

  const entity = await prisma.canyon.findFirst({
    where: { id: req.params.id, ownerId: user.id },
  });
  if (!entity) throw new AppError(404, "Not found");

  res.json(entity);
});

export default router;
```

Register in `src/index.ts`. Mount paths can overlap (e.g. `/canyons` + `/canyons/:canyonId/trips`); preserve order.

## Migrations

- Schema change → `npx prisma migrate dev --name <desc>` → commit new folder under `prisma/migrations/`.
- Never edit committed migration. Add new one.
- After schema change, `npx prisma generate` runs as part of `migrate dev`, but rerun manually if Prisma types feel stale.

**Prisma 7 specifics** (since the 5→7 upgrade):
- `prisma.config.ts` owns the datasource URL and seed command — `schema.prisma` has no `datasource.url`, `package.json` has no `prisma.seed`.
- `npm ci`/`npm install` no longer auto-generates the client: run `npx prisma generate` after a fresh install or `tsc` fails on missing types. The Dockerfile runs generate right after `npm ci` for this reason — keep that ordering.
- Client construction needs the `@prisma/adapter-pg` driver adapter (see `services/prisma.ts`); anything importing it (incl. integration tests) needs `DB_HOST`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` at import time, composed via `lib/databaseUrl.ts` (`vitest.config.ts` loads dotenv for this).
- **RDS TLS:** node-postgres does NOT negotiate TLS by default (the pre-7 Prisma engine did) — RDS rejects plain connections with `no pg_hba.conf entry ... no encryption`. The Docker image bundles the RDS CA at `/app/rds-ca.pem` (Dockerfile ADD); `services/prisma.ts` enables *verified* TLS whenever that file exists, and stays plain on the dev host where it doesn't. `DATABASE_SSL_CA` overrides the path (fails loud if missing). `DATABASE_SSL=disable` forces a plain connection even when the CA is present — set only on local-dev worker task defs (`infra/terraform/envs/local/ecs.tf`), which run the prod image (CA bundled) against the local non-SSL Postgres. Broke prod on 2026-06-11; don't remove either half.

## Testing

Integration tests in `__tests__/` run against live local API. `make dev` must run first. `npm test` does not spin own server.

## Conventions log (additive)

- **Bulk collection endpoints must cap array length explicitly (both ends).** Any POST that does per-element work over a request array (import/delete) must reject empty AND oversized inputs: `length === 0` → `AppError(400)`, `length > LIMIT` → `AppError(413)`. Mirror the sibling limit in the file (`BULK_DELETE_LIMIT` / `BULK_IMPORT_LIMIT`). The 1 MB body cap + 300/min limiter are not a substitute. (SEC-001, 2026-06-22)
- **Any new S3-writing pipeline must be added to the account-delete purge (`DELETE /users/me`, `routes/users.ts`).** Pre-fetch the owning rows, delete their S3 keys/prefix in the same S3-first `Promise.all` (S3 before the DB transaction so a failed delete leaves rows for retry), and add the matching `prisma.<model>.deleteMany({ where: { userId } })` to the explicit list even when a cascade covers the row — the cascade removes DB rows but never S3 objects. The GeoPDF pipeline re-opened this gap by post-dating the topo-job/export coverage. (ARCH-001, 2026-06-22)
- **Never log a raw thrown error; scrub it with `safeErrorForLog` (`lib/logger.ts`).** Pino's `redact.paths` only censor structured keys — they cannot reach free text inside `err.message`/`err.stack`, and Prisma renders user-supplied canyon name/coords into validation-error messages. The global `errorHandler` logs `safeErrorForLog(err)`; any new direct `logger.*({ err })` site must do the same. (SEC-001 DoD, 2026-06-22)
- **Use the pino `logger` (`lib/logger.ts`), never `console.*`, with the `(obj, msg)` call shape.** `console.*` bypasses pino's redaction + transport (and `console.error(obj, msg)` logs `[object Object]`); pass structured fields as the first arg and a stable event string as the message: `logger.error({ jobId, reason }, "topo_runtask_failed")`. Only exceptions: `lib/env.ts` and `boot.ts`, which run before the logger exists. (CH-004, 2026-06-22)