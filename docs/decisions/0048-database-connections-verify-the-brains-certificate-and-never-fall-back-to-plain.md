# 0048. Database connections verify the brain's certificate and never fall back to plain

- **Date:** 2026-11-11
- **Status:** Accepted
- **Supersedes:** [0001](0001-rds-tls-via-bundled-ca.md)

## Context

[0001](0001-rds-tls-via-bundled-ca.md) had the API image bundle RDS's CA and
verify TLS whenever that file existed, staying plain where it did not. Prod's
database is now the brain's Postgres
([0047](0047-prod-runs-on-one-self-managed-instance-with-object-lock-backups.md)),
whose server certificate is self-signed and made at first boot. RDS is deleted
and its bundle is gone from `api/Dockerfile`, so 0001's file-exists test would
have a prod process with no certificate quietly connect in the clear: the
fallback that served a developer's laptop also served a mis-built image.

## Decision

Nothing in prod connects to Postgres without verifying the brain's
certificate by name.

- The certificate's public half is committed as `brain-ca.pem` in `infra/brain/`,
  copied to `topo/` (the worker image's build cannot read outside `topo/`;
  `ci.yml` fails when the two differ) and bundled at `/app/brain-ca.pem` into
  the API image and the topo worker image. A build fails without it.
- `/app/brain-ca.pem` is the default certificate in every process, and
  `DATABASE_SSL_CA` names another path. The API's pool and sweep-lock client
  (`api/src/lib/dbConnection.ts`) verify against it and refuse to start in
  `NODE_ENV=production` without one, and a configured path that is missing
  fails loud. The migrate task (`api/prisma.config.ts`) uses Prisma's strict
  mode against it in production. The Python workers
  (`topo/worker_common.py`) use `sslmode=verify-full` against it.
- `DATABASE_SSL=disable` is the only way to a plain connection: for local
  dev, whose Postgres is plain TCP (`infra/terraform/envs/local/ecs.tf`, the
  CI worker env `topo/tests/e2e/worker.env`). With `NODE_ENV=production` the
  API refuses it (`validateEnv`), and so do the migrate URL and the Python
  workers. The workers' task definitions set no `NODE_ENV`, so what holds
  them is that no prod task definition names `DATABASE_SSL`.

Guards: `api/src/lib/dbConnection.unit.test.ts` (the default, the production
refusal, the missing override, plain in development),
`api/src/lib/databaseUrl.unit.test.ts` (the migrate URL, an empty
`DATABASE_SSL_CA` read as unset, its production refusal),
`api/src/lib/env.unit.test.ts` (`DATABASE_SSL=disable` refused in production),
`topo/tests/test_worker_helpers.py` (the workers' URL and their production
refusal) and the run `prod_runs_on_the_brain` in
`infra/terraform/envs/prod/tests/guards.tftest.hcl` (no prod task definition
sets `DATABASE_SSL`). Each names its mutation.

## Consequences

- **Positive:** an image built or deployed without the certificate stops at
  start, never on an unverified connection; local dev is unchanged.
- **Negative:** the certificate belongs to one brain. A brain rebuilt with a
  new Elastic IP needs a new committed certificate and new images (0047
  already says so); a restore from backups brings the same certificate back.
- **Negative:** every local or CI process that talks to a plain Postgres must
  say `DATABASE_SSL=disable`, where the Python workers used to negotiate TLS
  opportunistically with no variable.

## Alternatives considered

- **Keep 0001's rule with the brain's file in place of RDS's.** Verify when
  the file exists, plain when it does not. Rejected: it is the behaviour that
  would let a prod process without the certificate connect in the clear.
- **No default: refuse to start unless `DATABASE_SSL_CA` is set.** Smaller to
  state, but every worker task definition, local task and test would have to
  name the variable, where the default is one constant per process. The prod
  task definitions still set it (`local.db_environment` in `ecs.tf`).
