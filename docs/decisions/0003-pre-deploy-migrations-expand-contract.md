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
