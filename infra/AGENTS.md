# Infra

Terraform (`terraform/`, >= 1.10) is the source of truth for prod AWS
(`terraform/envs/prod`, S3 state; `terraform output` there gives prod's
values), for this repository's GitHub settings (`terraform/envs/github`:
rulesets, Environments, Actions variables, labels,
[0025](../docs/decisions/0025-github-settings-in-terraform.md)) and for local
dev's MiniStack resources and `.env.local` (`terraform/envs/local`, which
`make dev` applies).

- **Prod and GitHub settings apply only from `terraform-apply.yml`, never a laptop:** merging a PR
  applies the plan the maintainer read in its comment, and the workflow refuses
  any other plan (`infra/scripts/plan-summary.mjs`,
  [0026](../docs/decisions/0026-plan-fingerprint-covers-planned-values.md)).
  `terraform plan` is read-only. The one exception is a change to the apply
  role or its boundary (`terraform/envs/prod/iam_apply.tf`), which that role
  may not make: the maintainer applies it from their machine.
  A plan in `envs/prod` on a fresh checkout fails until the Lambda bundle it
  zips is built: `cd infra/lambda/cognito-email-sender && npm ci && npm run build`.
- **Change AWS and the repository's GitHub settings only through Terraform,**
  never the console, the CLI or GitHub's Settings pages: what is made by hand
  is drift the next plan undoes. Secret values, the two settings Apps and
  private vulnerability reporting are set by hand (0025).
- **A new secret** is an `aws_secretsmanager_secret` with no version in
  Terraform; its value is set by hand and tasks read the resource's `.arn`. A
  literal ARN is only for a secret made outside Terraform.
- **CI owns deploy-time fields:** image revisions (`infra/scripts/pin-ecs-task-image.sh`),
  the EB environment's `setting`s and the frontend bucket's contents. Terraform
  ignores them; never make it manage them.
- **A plan that destroys or replaces a stateful resource** (RDS, S3, Cognito,
  CloudFront, EB) is a stop: ask. Never remove `prevent_destroy` to get past one.
- **The CI roles' privacy Deny** (`local.ci_readonly_privacy_deny` in
  `terraform/envs/prod/iam.tf`) stays on every read-only role and in the apply
  role's boundary: CI never reads user data, audit objects, logs or secret
  values. Objects in this account's buckets and log events are denied by
  default; a bucket CI must read objects from is added to the Deny's
  exceptions and to its guard.
- **The brain's signals bucket holds no user data** (`release.json`,
  `status.json`, `drill.json`: a release pointer and health files). The brain and the watchdog read it; CI only writes
  `release.json` to it and never reads it, so it is not an exception of the CI
  privacy Deny, and nor is the backup bucket. Because the Deny stops reads,
  Terraform cannot manage an object in either bucket (creating one reads it
  back). Guard: the exceptions assert and the signals assert in
  `ci_reads_no_secret_or_user_data` (`terraform/envs/prod/tests/guards.tftest.hcl`).
- **The brain's backup bucket never gets a rule that expires or moves current
  versions.** pgBackRest expires backups by count; an age rule would delete the
  only backup after a run of failed nights. Its Object Lock stays COMPLIANCE,
  7 days. Guard: `brain_backups_are_locked_and_never_expire`.
- **The brain's Postgres image tag is immutable and pinned** in Terraform
  (`var.brain_pg_image_tag`); the repository refuses a push to an existing tag,
  so publish a new tag and change the variable, never retag. Guard:
  `brain_postgres_image_is_immutable`.
- **The brain's instance role** (`logjam-brain`) holds only the grants in
  `brain_iam.tf`, managed exclusively: no audit bucket, no secret beyond the
  app database, origin-verify and Resend, no write to `release.json`, and no
  AWS-managed broad policy. Guard: `brain_role_has_only_its_grants`.
- **The Postgres image** (`brain/postgres/`) is what local dev runs and what
  prod's database will run. Its `postgresql.conf` keeps row values and
  statement parameters out of logs; `brain/postgres/tests/test.sh` (CI job
  `brain-postgres`) reads the live settings back. Never give `BRAIN_INIT` a
  default: an empty data directory must stop the container, not create a database.
- **The brain host** (`brain/host/`, `brain/compose.yaml`) holds a database's
  disk. `boot.sh` formats only a device blank to `blkid`, `wipefs` and a zeroed
  first MiB, and starts Postgres with `BRAIN_INIT=bootstrap` only when the
  flag is exactly `1`; keep both, and keep `create_host_path: false` on the
  data mount. `brain/tests/e2e.sh` (CI job `brain-e2e`) plays the host's life
  on a loop device; each mutation it names turns it red.
