# API — Logjam

Express 5 + Prisma 7 + TypeScript REST backend. Port 8080 dev.

**Canonical examples:**
- Route file w/ auth + AppError + Prisma: `routes/places.ts`.
- Route w/ AWS SDK (S3 presign + ECS task launch): `routes/topoJobs.ts`. Launch tasks only via `lib/ecsRunTask.ts`, which force-fails the job when RunTask placement fails — never `RunTaskCommand` directly in a route.
- Ownership checks: filter by `ownerId` / verify via join — see `routes/topoJobs.ts`.

## Hard rules

- **Auth on every route** except `/health`: `requireAuth`, then `resolveUser(req.user!.sub)` from `lib/resolveUser.ts` for the internal user (throws `AppError(404)` if no row; GET /users/me is the documented exception). Never an inline `prisma.user.findUnique({ where: { cognitoId } })`.
- **Ownership check mandatory** on any read/write of a user-owned entity: `ownerId: user.id` or a join (`shares: { some: { sharedWithId: user.id } }`). Never trust an id from the body without it. Shared places go through `lib/placeAccess.ts` (root `AGENTS.md`).
- **Errors:** throw `AppError(status, message)` from `middleware/errorHandler`; never `res.status(500).json(...)`, never catch-and-swallow.
- **Prisma:** import the default export of `services/prisma`; never `new PrismaClient()` (it needs the `@prisma/adapter-pg` adapter built from `lib/databaseUrl.ts`).
- **AWS SDK v3:** use the `s3` / `ecs` / `cognitoIdp` singletons from `services/awsClients.ts` (they honour `AWS_ENDPOINT_URL` for MiniStack); commands per call via `client.send()`. Email is Resend (`services/email.ts`), not AWS.
- **Env:** read via `getEnv()` (`lib/env.ts`, zod-validated at boot), never raw `process.env` outside `lib/env.ts`/`boot.ts`. A new var goes in the schema AND, for local dev, `infra/terraform/templates/env.local.tftpl` (renders `.env.local`). Prod values: `cd infra/terraform/envs/prod && terraform output`. The EB API resolves `DB_USER`/`DB_PASSWORD` from `DB_SECRET_ID` in `src/boot.ts`; ECS workers get them by secrets injection.
- **RDS TLS:** `services/prisma.ts` uses verified TLS when the bundled CA exists; keep both it and `DATABASE_SSL=disable` on the local worker task defs. [0064](../docs/decisions/0064-rds-tls-via-bundled-ca.md)
- **Logging:** the pino `logger` (`lib/logger.ts`), never `console.*` (only `lib/env.ts` and `boot.ts`, which run before it exists), shaped `logger.error({ jobId, reason }, "topo_runtask_failed")`. Never log a raw thrown error: pass it through `safeErrorForLog` — Prisma renders user place names/coords into error messages and `redact.paths` can't reach free text (`lib/logger.unit.test.ts`).

## Routes

Register routers in `src/index.ts`. Mount paths can overlap (`/places` + `/places/:placeId/trips`); preserve order.

## Migrations

- Schema change → `npx prisma migrate dev --name <desc>` → commit the new `prisma/migrations/` folder. Never edit a committed migration.
- **Prod migrations run in a gated pre-deploy task, not at boot** (`deploy-api.yml`); a failing migration aborts the deploy. [0020](../docs/decisions/0020-pre-deploy-migrations-expand-contract.md)
- **Migrations are expand/contract:** the old image runs against the new schema during the swap, so never drop/rename/narrow what it still uses in the same migration. [0020](../docs/decisions/0020-pre-deploy-migrations-expand-contract.md)
- **Tested as an upgrade:** CI's `migration-upgrade` job (`scripts/migration-upgrade-test.sh seed`) migrates + seeds at `origin/main`, upgrades to HEAD, asserts `api/prisma/upgrade-check/{baseline,verify}.sql` and zero drift from `schema.prisma`. Needs an EMPTY Postgres and `npm ci` in `api/`. Its data checks are release-specific: a release whose migrations move data replaces them. Before a prod release, rehearse on a restored snapshot copy in `existing` mode (`UPGRADE_TARGET_IS_A_COPY=yes`).
- Prisma 7: `prisma.config.ts` owns the datasource URL and seed command. `npm ci` doesn't generate the client — run `npx prisma generate` (the Dockerfile runs it right after `npm ci`; keep that order).
- A nullable sort column says where NULL sorts (`nulls: "first"` for system rows). [0011](../docs/decisions/0011-place-types-and-system-rows.md)

## Conventions log (additive)

- **Bulk endpoints cap array length at both ends:** empty → `AppError(400)`, over the sibling limit (`BULK_DELETE_LIMIT` / `BULK_IMPORT_LIMIT`) → `AppError(413)`. The body cap and rate limiter are no substitute. Guard: `src/__tests__/placesBulk.test.ts`.
- **Any new S3-writing pipeline joins the account-delete purge** (`DELETE /users/me`, `routes/users.ts`): its S3 keys in the S3-first `Promise.all`, and its `deleteMany` in the explicit list even when a cascade covers the row — a cascade never deletes S3 objects. No automated guard (`src/__tests__/users.test.ts` does not drive the purge).
- **Any hard-delete of a synced entity calls `writeTombstones` (`lib/syncTombstones.ts`) in the same transaction**, fanned out to every user who could see the row; `SYNC_ENTITY_TYPES` in `shared/src/sync.ts` lists the entities. Tombstones carry ids only. Guard: `lib/syncTombstones.unit.test.ts`.
- **A push-op validator and its REST twin accept the same field set**, one-sided bounds included; test the op path too (`src/__tests__/syncPush.test.ts`, "a definition keeps a one-sided bound").

## Testing

| Suite | Command | Needs |
|---|---|---|
| unit | `npm run test:unit` (`*.unit.test.ts`, colocated) | nothing — must pass with no server running; if it needs one it's misfiled |
| integration | `npm test` (`src/__tests__/*.test.ts`) | a running local API (`make dev` first); it does not start its own server |

- Unit tests mock Prisma via `vi.mock("../services/prisma")` and AWS via the `@aws-sdk/*` module; never a real service.
- **Multi-user integration tests:** fake auth honours an `x-fake-sub` header (dev only, fail-closed in `src/middleware/auth.ts`). Use `src/__tests__/_actors.ts`: `as(BOB_SUB)` / `as(CAROL_SUB)` onto a supertest `.set(...)`; no header = alice. The seed gives alice/bob/carol with friendships + shares; see `src/__tests__/shareBoundary.test.ts`.
- **Rate limits:** the global limiter keys per IP, so all actors share one budget; files run sequentially and `src/__tests__/_rateLimitGate.ts` sleeps to the window reset. The per-user `userPatchLimiter` on write routes is invisible to that gate: a write-heavy file wraps writes in the `write()` retry from `src/__tests__/placeTypes.test.ts` / `src/__tests__/customFields.test.ts` and raises its timeout past 61s.
- **Fixtures:** small canned inputs in `__fixtures__/` beside their test (`src/services/__fixtures__/sample.mvt`), not inline blobs.
