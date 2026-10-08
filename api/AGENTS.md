# API

## Routes and access

- **Every route but `/health`** runs `requireAuth`, then `resolveUser(req.user!.sub)`
  (`lib/resolveUser.ts`) for the internal user; never look a user up by
  `cognitoId` inline.
- **Every read or write of a user-owned row checks ownership** (`ownerId: user.id`
  or a join through `shares`); never trust an id from the body alone.
- **A place reaches anyone but its owner only through `lib/placeAccess.ts`**
  and `serializeSharedPlace`, on REST and delta alike: no access is 404, not
  403. Guard: `src/__tests__/shareBoundary.test.ts`. [0002](../docs/decisions/0002-place-share-visibility.md)
- **A response about another user carries their username, never their email**
  (`src/__tests__/friends.test.ts`).
- **Errors are `AppError(status, message)`** from `middleware/errorHandler`,
  never `res.status(500)` or a bare `Error`: an upstream that refused is 502, a
  dependency we own that is missing is 503.
- **An array in a request body is capped at both ends:** empty is 400, over
  its limit 413; the body-size cap is no substitute (`src/__tests__/placesBulk.test.ts`).

## Logging and config

- **Log through `logger` (`lib/logger.ts`), never `console.*`,** and never a raw
  thrown error: pass it through `safeErrorForLog`. Prisma renders place names
  and coordinates into its messages, which `redact.paths` cannot reach.
- **Env is read through `getEnv()` (`lib/env.ts`).** A new variable goes in its
  schema and in `infra/terraform/templates/env.local.tftpl`, which renders
  `.env.local`.
- **AWS clients are the singletons in `services/awsClients.ts`:** they honour
  `AWS_ENDPOINT_URL`, so local dev stays on MiniStack.

## Data

- **New storage for user data (a table or an S3 prefix) joins the
  account-delete purge** in `routes/users.ts`: S3 keys in its `Promise.all`,
  the table in its explicit `deleteMany` list, even under a cascade, which
  never deletes S3 objects. `src/routes/accountPurge.unit.test.ts` guards the
  tables (each is deleted there or named as cascade-only); nothing guards the
  S3 prefixes.
- **A hard delete of a synced entity calls `writeTombstones`**
  (`lib/syncTombstones.ts`) in the same transaction, for every user who could
  see the row, or phones keep it forever.
- **A sync push op and its REST twin accept the same fields,** bounds
  included; a change to one is tested on both (`src/__tests__/syncPush.test.ts`).
- **Never remove or narrow a `/sync/*` field, op or protocol that a
  supported build still uses (until three months after its successor ships):**
  it stays on phones, often offline, until its owner updates. No guard test.
  [0022](../docs/decisions/0022-mobile-builds-supported-three-months.md)

## Migrations

- `npx prisma migrate dev --name <desc>`, commit the folder, never edit a
  committed migration.
- **Expand/contract:** prod migrates in a pre-deploy task while the old image
  still runs, so never drop, rename or narrow what it uses in the same
  migration. [0003](../docs/decisions/0003-pre-deploy-migrations-expand-contract.md)
- A migration that moves data replaces the checks in `prisma/upgrade-check/`,
  which CI's `migration-upgrade` job runs against a seeded `origin/main`.

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
- **Fixtures** are the source's real output, in `__fixtures__/` beside the test.
