# Logjam Terraform IaC

Terraform is the single source of truth for Logjam's AWS infrastructure
(account `620853681701`, `ap-southeast-2`), and it also provisions the local
LocalStack S3 buckets so dev tracks prod. All prod resources were **imported**
from the existing hand-created infra — nothing was recreated.

## Layout

```
infra/terraform/
├── bootstrap/        # one-shot: creates the S3 state bucket (local backend)
├── modules/
│   └── storage/      # reusable S3 bucket (+ SSE/PAB/CORS/lifecycle) — used by prod AND local
├── envs/
│   ├── prod/         # real AWS. S3 backend (logjam-tfstate-620853681701). One file per concern:
│   │                 #   ecr / s3 / logging / iam / ecs / ecs_cluster / network /
│   │                 #   rds / cognito / cloudfront / eb, plus outputs.tf
│   └── local/        # LocalStack S3 only (provider aliased at :4566, dummy creds).
│                     #   Generates the repo-root .env.local from the template.
└── templates/
    └── env.local.tftpl   # shape of the generated .env.local
```

## Prerequisites

- `terraform` >= 1.10 (native S3 state locking; import blocks)
- AWS auth for the `logjam` account (e.g. `aws sts get-caller-identity`)

## Common workflows

```bash
# Prod: inspect / converge (read-only plan)
cd infra/terraform/envs/prod && terraform plan

# Prod canonical values (cross-check against .ebextensions + task-def env)
terraform output

# Local: provisioned automatically by `make dev` / `make reset` (LocalStack only)
```

## Conventions

- **State:** prod uses the S3 backend with native lockfile (no DynamoDB). The
  state bucket is created by `bootstrap/` (local state, applied once).
- **`prevent_destroy`** guards RDS, Cognito (pool + client), both CloudFront
  distributions, and the EB environment. A bad plan errors instead of deleting.
- **CI still owns deploys.** GitHub Actions builds/pushes images, deploys EB
  versions (`.ebextensions` DB env), and syncs/invalidates the frontend. So the
  EB environment ignores `setting`, and task defs reference `:latest`. Terraform
  must never fight CI over those fields.
- **Env single-source rule:** the authoritative variable LIST is
  `api/src/lib/env.ts` (zod). The local dev VALUES live in
  `envs/local/env-files.tf` + `templates/env.local.tftpl`. Add a var in **both**
  `env.ts` and the template. The prod values are surfaced by
  `envs/prod` `terraform output`.
- **Apply gating (operator workflow):** import-only / zero-change applies are
  safe (no AWS modification). Any apply that creates/modifies/destroys real
  resources is reviewed before running.
- **Cognito email Lambda build step:** `envs/prod/lambda_cognito_email.tf` zips
  the prebuilt `infra/lambda/cognito-email-sender/dist/`. Build it before
  `plan`/`apply` or the bundle is stale/missing:
  `cd infra/lambda/cognito-email-sender && npm ci && npm run build`. The
  `source_code_hash` diff reflects code changes.

## Coverage

As of the last pass, Terraform manages effectively all Logjam prod AWS infra,
including the previously peripheral resources (CloudFront OACs, the GitHub OIDC
provider, the RDS SG `sg-06cc0aaa310968aa4`, the S3 OAC bucket policies, and the
two CloudFront WAF web ACLs in us-east-1 via the `aws.us_east_1` provider alias).

Done cleanups: dead SQS removed (queue + `SQS_QUEUE_URL` env + SQS IAM perms);
`SES_FROM_ADDRESS` removed from `api/src/lib/env.ts`; abandoned Amplify Gen2
backend (separate unused Cognito pool `ap-southeast-2_b4d4RzXTR`) deleted.

### Remaining minor residue (not managed, low value)

- **Orphan OAC `E319QVNMQMF9JU`** ("logjam-frontend-oac") — created but used by no
  distribution. Not imported; delete directly if you want it gone.
- **EB instance SG `sg-016b93b75c584bd70`** — EB-managed; referenced as a literal
  in the RDS SG ingress rule, intentionally not adopted.
