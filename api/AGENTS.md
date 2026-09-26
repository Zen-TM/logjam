# API

## Auth, access and errors

- **Every route but `/health`** runs `requireAuth`, then `resolveUser(req.user!.sub)`
  (`lib/resolveUser.ts`) for the internal user; never look a user up by
  `cognitoId` inline.
- **Every read or write of a user-owned row checks ownership** (`ownerId: user.id`
  or a join through `shares`); never trust an id from the body alone.
- **Share visibility:** a sharee sees the place record plus place-level
  `notes`/`media`; per-trip notes, media and the trip list are owner-private,
  and so is any count or aggregate over them. Every place endpoint decides
  through `lib/placeAccess.ts`: no access is **404**, a sharee attempting an
  owner-only action is 403. A sharee receives `serializeSharedPlace` over the
  denylist in `lib/placeVisibility.ts`, on REST and delta alike. Guards:
  `src/__tests__/shareBoundary.test.ts`, `lib/placeAccess.unit.test.ts`,
  `lib/placeVisibility.unit.test.ts`. [0001](../docs/decisions/0001-place-share-visibility.md)
- **A `PlaceLink` grants no visibility;** `Route.placeId` carries a route to a
  sharee (`src/__tests__/placeLinks.test.ts`). [0003](../docs/decisions/0003-place-links-grant-no-visibility.md)
- **`foreignFields`** has exactly two writers (copy, place-type change), is
  owner-private, and no client can push it (`routes/placeFields.unit.test.ts`,
  `src/__tests__/placeCopy.test.ts`). [0002](../docs/decisions/0002-foreign-fields.md)
- **Friend search and lists never return `email`** (`src/__tests__/friends.test.ts`).
- **System place types** (`ownerId = null`) are undeletable and unrenameable
  (404), sort first with an explicit `nulls: "first"`, and a delta row spec
  accepts `ownerId: null` (`src/__tests__/syncBoundary.test.ts`). [0011](../docs/decisions/0011-place-types-and-system-rows.md)
- **Errors are `AppError(status, message)`** from `middleware/errorHandler`,
  never `res.status(500)` or a bare `Error`: an upstream that refused is 502, a
  dependency we own that is missing is 503 (`services/ropeWikiCache.unit.test.ts`). [0062](../docs/decisions/0062-upstream-failures-are-apperrors.md)

## Logging and config

- **Log through `logger` (`lib/logger.ts`), never `console.*`,** and never a raw
  thrown error: pass it through `safeErrorForLog`. Prisma renders place names
  and coordinates into its messages, which `redact.paths` cannot reach.
- **Env is read through `getEnv()` (`lib/env.ts`).** A new variable goes in its
  schema AND in `infra/terraform/templates/env.local.tftpl`, which renders
  `.env.local`.
- **AWS clients are the singletons in `services/awsClients.ts`**: they honour
  `AWS_ENDPOINT_URL`, so local dev stays on MiniStack. Launch ECS tasks only
  through `lib/ecsRunTask.ts`, which fails the job when placement fails.

## Data rules

- **Bulk endpoints cap array length at both ends:** empty is 400, over
  `BULK_DELETE_LIMIT` / `BULK_IMPORT_LIMIT` is 413 (`src/__tests__/placesBulk.test.ts`).
- **A new S3-writing pipeline joins the account-delete purge** (`DELETE /users/me`
  in `routes/users.ts`): its keys in the S3-first `Promise.all`, its
  `deleteMany` in the explicit list even under a cascade, which never deletes
  S3 objects. No test drives the purge.
- **A hard delete of a synced entity calls `writeTombstones`** (`lib/syncTombstones.ts`)
  in the same transaction, for every user who could see the row.
- **A push-op validator and its REST twin accept the same fields,** one-sided
  bounds included; test the op path too (`src/__tests__/syncPush.test.ts`).
- **A reaper-queued job claims its row** by flipping a status-guarded `*At`
  column null→now in one `updateMany`, and acts only if exactly one row flipped
  (`queueAutoExports`, `lib/topoJobReaper.unit.test.ts`).
- **A slow-changing third-party corpus is an S3 snapshot** (`reference/` in the
  media bucket, `getRopeWikiCanyons`); the live fetch stays behind `?fresh=true`. [0063](../docs/decisions/0063-external-corpora-snapshot-and-real-fixtures.md)
- **A new format assertion on a request path runs against the seed and the
  fixtures,** with a test (`lib/seedIds.unit.test.ts`). [0061](../docs/decisions/0061-format-assertions-run-against-the-seed.md)

## Migrations

- `npx prisma migrate dev --name <desc>`, commit the folder, never edit a
  committed migration.
- **Expand/contract:** prod migrates in a pre-deploy task while the old image
  still runs, so never drop, rename or narrow what it uses in the same
  migration. [0020](../docs/decisions/0020-pre-deploy-migrations-expand-contract.md)
- CI's `migration-upgrade` job (`scripts/migration-upgrade-test.sh`) upgrades a
  seeded `origin/main` database to HEAD and runs the checks in
  `prisma/upgrade-check/`; a release whose migrations move data replaces them.

## Testing

| Suite | Command | Needs |
|---|---|---|
| unit | `npm run test:unit` (`*.unit.test.ts`, colocated) | nothing; a unit test that needs a server is misfiled |
| integration | `npm test` (`src/__tests__/*.test.ts`) | a running local API (`make dev`); it starts none |

- Unit tests mock Prisma (`vi.mock("../services/prisma")`) and the `@aws-sdk/*`
  modules. Don't unit-test a thin Prisma/AWS pass-through; integration covers
  it, so extract any pure logic and test that.
- **Multi-user tests** use `src/__tests__/_actors.ts`: `as(BOB_SUB)` /
  `as(CAROL_SUB)` sets the fake-auth `x-fake-sub` header; none is alice.
- **Rate limits:** actors share the per-IP budget and `_rateLimitGate.ts` waits
  it out, but not the per-user `userPatchLimiter`: a write-heavy file uses the
  `write()` retry from `src/__tests__/placeTypes.test.ts` and a timeout over 61 s.
- **Fixtures** are the source's real output, in `__fixtures__/` beside the test. [0063](../docs/decisions/0063-external-corpora-snapshot-and-real-fixtures.md)
