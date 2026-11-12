# 0003. Prod migrations run in a gated pre-deploy task; migrations are expand/contract

- **Date:** 2026-07-17
- **Status:** Accepted
- **Supersedes:** —

## Context

Running migrations at container boot risks crash-looping the new container when
a migration fails, taking the service down instead of keeping the previous
version serving. Furthermore, when migrations run pre-deploy before the new
container image serves, the old running image must execute against the new
schema during the swap window. A destructive single-step migration will error
mid-swap or break the old image.

## Decision

- **Prod migrations run in a gated pre-deploy one-shot, NOT at container boot.**
  `deploy-api.yml` RunTasks `aws_ecs_task_definition.api_migrate` (`prisma migrate deploy`,
  image just pushed to `:latest`, as the least-priv `logjam_app` role) and gates
  the EB version swap on its exit code — a failing migration aborts the deploy
  with the old version still serving, instead of crash-looping the new container
  at boot. `boot.ts` no longer migrates.
- **CI migration validation:** CI additionally validates every migration against
  an ephemeral Postgres (`ci.yml` `migrations` job) so bad SQL is caught at PR
  time, and replays them over a seeded `origin/main` database with data assertions
  and a zero-drift check (`migration-upgrade`; root `AGENTS.md` → Testing).
- **Migrations MUST be backward-compatible with the currently-running image (expand/contract).**
  The pre-deploy migrate applies the new schema *before* the new image serves, so
  the old image runs against the new schema during the swap window. Never
  drop/rename a column or narrow a constraint the currently-deployed code still
  reads/writes in the same migration that the new code needs — split it:
  1. **Expand:** add the new shape, both codes tolerate it, deploy;
  2. **Contract:** later, once no running code uses the old shape, remove it.
  A destructive single-step migration will error mid-swap or break the old image.
- **Update 2026-10-24: one narrow exception, for usernames.** Migration
  `20261024150000_username_unique_as_read` adds a unique index on
  `lower(username)` in the same release as the API change that names it
  (issue #360). It narrows what the previous image may write: a first login
  whose name is a case variant of an existing one gets a P2002 that image
  cannot name, so it answers 500 instead of creating the duplicate that was
  the bug. This costs a failed first login during the swap window and for as
  long as a rollback keeps the newer schema, and loses no row; PATCH is
  unaffected because it already answers any P2002 with its 409, and reads keep
  the exact index. Everything else above stands.

## Consequences

- **Positive:** A failing migration aborts the deploy with the old version still
  serving, instead of crash-looping the new container at boot; bad SQL is caught
  at PR time.
- **Negative:** Schema changes that drop/rename columns or narrow constraints
  cannot be done in a single step and must be split into expand and contract
  phases across multiple deploys.
- **Neutral:** Not recorded.

## Alternatives considered

- Migrating at container boot (`boot.ts`): rejected; a failing migration
  crash-loops the new container at boot instead of aborting the deploy with the
  old version still serving.
- Destructive single-step migrations: rejected; errors mid-swap or breaks the old
  image during the swap window.
- Splitting the username index from the API change that names it (2026-10-24):
  rejected in favour of the exception above, because it would take two
  releases to close issue #360 and leave the duplicate-case window open for
  one of them; the accepted cost is a failed case-variant first login during a
  swap or rollback, never data loss.
