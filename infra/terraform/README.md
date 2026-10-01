# Terraform

Terraform describes all of prod AWS (`envs/prod`) and the local dev stack's
MiniStack resources (`envs/local`). What it builds is described in
[`docs/architecture.md`](../../docs/architecture.md). The rules for changing
it are in [`infra/AGENTS.md`](../AGENTS.md). This page lists the commands.

```
bootstrap/         the S3 bucket that holds prod's state. Applied once; never re-run
modules/storage/   one S3 bucket with encryption, public-access block, CORS, lifecycle
envs/prod/         prod AWS, one file per concern; state in S3
envs/local/        MiniStack S3 and ECS task definitions, and the repo's .env.local
templates/         env.local.tftpl, the shape of .env.local
```

You need Terraform 1.10 or later. CI uses 1.13.

## Check a change (no AWS needed)

These are the checks `terraform-ci.yml` runs on a PR:

```sh
terraform fmt -check -recursive infra/terraform
terraform -chdir=infra/terraform/envs/prod init -backend=false -input=false
terraform -chdir=infra/terraform/envs/prod validate
```

To check `bootstrap` or `envs/local`, run the last two commands against that
directory instead.

The prod plan runs on your PR by itself (`terraform-plan.yml`) and is posted
as a comment. Merging applies that plan
([0024](../../docs/decisions/0024-prod-terraform-applies-on-merge-by-plan-fingerprint.md)).

## Read prod (maintainer's AWS access)

Look up a prod value. The names are listed in
[`docs/architecture.md`](../../docs/architecture.md#looking-up-ids):

```sh
cd infra/terraform/envs/prod
terraform init -input=false
terraform output <name>
```

Plan locally. Build the Cognito email Lambda first, because the plan hashes
its bundle. Pass `-lock=false` so a read-only plan never holds the lock the
apply workflow needs:

```sh
(cd infra/lambda/cognito-email-sender && npm ci && npm run build)
terraform -chdir=infra/terraform/envs/prod plan -lock=false
```

Never apply prod from a laptop. The one exception is a change to
`envs/prod/iam_apply.tf`, which the maintainer applies from their own machine
(`infra/AGENTS.md`).

## Local

`make dev` and `make reset` apply `envs/local` for you. Don't apply it by
hand.
