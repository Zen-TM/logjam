# Infra

Terraform (`terraform/`, >= 1.10) is the source of truth for prod AWS
(`terraform/envs/prod`, S3 state; `terraform output` there gives prod's
values) and for local dev's MiniStack resources and `.env.local`
(`terraform/envs/local`, which `make dev` applies).

- **Never run `terraform apply` on `terraform/envs/prod`:** prod changes reach
  AWS only after the maintainer has read the plan. `terraform plan` is
  read-only, and CI posts one on every PR that touches `infra/terraform/`.
- **Change AWS only through Terraform,** never the console or the CLI: what is
  made by hand is drift the next plan undoes.
- **CI owns deploy-time fields:** image revisions (`infra/scripts/pin-ecs-task-image.sh`),
  the EB environment's `setting`s and the frontend bucket's contents. Terraform
  ignores them; never make it manage them.
- **A plan that destroys or replaces a stateful resource** (RDS, S3, Cognito,
  CloudFront, EB) is a stop: ask. Never remove `prevent_destroy` to get past one.
- **The CI roles' privacy Deny** (`local.ci_readonly_privacy_deny` in
  `terraform/envs/prod/iam.tf`) stays on every read-only role: CI never reads
  user data, audit objects or secret values.
