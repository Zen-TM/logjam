# Infra

Terraform (`terraform/`, >= 1.10) is the source of truth for prod AWS
(`terraform/envs/prod`, S3 state; `terraform output` there gives prod's
values) and for local dev's MiniStack resources and `.env.local`
(`terraform/envs/local`, which `make dev` applies).

- **Prod applies only from `terraform-apply.yml`, never a laptop:** merging a PR
  applies the plan the maintainer read in its comment, and the workflow refuses
  any other plan (`infra/scripts/plan-summary.mjs`,
  [0024](../docs/decisions/0024-prod-terraform-applies-on-merge-by-plan-fingerprint.md)).
  `terraform plan` is read-only. The one exception is a change to the apply
  role or its boundary (`terraform/envs/prod/iam_apply.tf`), which that role
  may not make: the maintainer applies it from their machine.
- **Change AWS only through Terraform,** never the console or the CLI: what is
  made by hand is drift the next plan undoes.
- **CI owns deploy-time fields:** image revisions (`infra/scripts/pin-ecs-task-image.sh`),
  the EB environment's `setting`s and the frontend bucket's contents. Terraform
  ignores them; never make it manage them.
- **A plan that destroys or replaces a stateful resource** (RDS, S3, Cognito,
  CloudFront, EB) is a stop: ask. Never remove `prevent_destroy` to get past one.
- **The CI roles' privacy Deny** (`local.ci_readonly_privacy_deny` in
  `terraform/envs/prod/iam.tf`) stays on every read-only role and in the apply
  role's boundary: CI never reads user data, audit objects or secret values.
