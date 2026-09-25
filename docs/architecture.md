# Architecture — Logjam in production

What runs where in AWS. Production lives in `ap-southeast-2`. Where a fact below
is an identifier that can drift (bucket names, distribution ids), the
`terraform output` that yields the current value is given beside it — run it in
`infra/terraform/envs/prod`; the output wins over this page.

## Infrastructure as code

- **Terraform** (`infra/terraform/`, see its README) is the single source of
  truth for prod AWS. Everything below was imported into Terraform, not
  recreated.
- The prod root is `envs/prod` (S3 backend); `terraform output` there gives the
  canonical values (`outputs.tf`).
- The `envs/local` root reuses the same `storage` module for MiniStack S3 and
  adds `ecs.tf` (cluster + worker task defs) so MiniStack RunTask launches
  workers locally.
- RDS, Cognito, CloudFront and Elastic Beanstalk carry `prevent_destroy`.
- CI still owns deploys: the EB environment ignores `setting`, and the worker
  task defs ride `:latest`.
- Infra PRs get `fmt`/`validate` (`terraform-ci.yml`) plus a read-only prod
  `terraform plan` posted as a PR comment (`terraform-plan.yml` — the CI role is
  ReadOnlyAccess with a privacy Deny on user-data object reads and secret
  values). `terraform apply` stays manual and operator-gated.

## Network

- The data plane is VPC-bound: reaching it needs SSM Session Manager, not SSH.

## API — Elastic Beanstalk

- Elastic Beanstalk runs the API as a single Docker container
  (`api/Dockerrun.aws.json`), image from the ECR repo `logjam-api`.
  CNAME: `terraform output eb_environment_cname`.

## Workers — ECS Fargate

- ECS Fargate runs the on-demand workers (cluster: `terraform output
  ecs_cluster`). Three task defs:
  - `logjam-topo-worker` and `logjam-topo-export-worker` — one Python image
    with a command override (see `topo/Dockerfile`).
  - `logjam-geo-pdf-worker` — the `logjam-api` Node image with command override
    `node dist/worker/geoPdfWorker.js`; defined by
    `aws_ecs_task_definition.geo_pdf_worker` in
    `infra/terraform/envs/prod/ecs.tf`.
- The API launches them on demand through the shared
  `api/src/lib/ecsRunTask.ts` helper (`RunTaskCommand` + placement-failure
  check), passing a job-ID env var (`JOB_ID` / `EXPORT_JOB_ID` /
  `GEO_PDF_JOB_ID`).
- ECS owns the task lifecycle; retry semantics are owned by the
  `TopoJob` / `TopoExportJob` / `GeoPdfJob` status columns (no SQS).
- Stuck jobs and exports are swept by the in-API reaper
  (`api/src/lib/topoJobReaper.ts`); the API stops orphaned Fargate tasks via
  StopTask using the persisted task ARN.

## Storage — S3

- Two app buckets, both used through presigned URLs for client upload and
  download:
  - `logjam-media` — photos/media (`terraform output s3_bucket_media`).
  - `logjam-topo-jobs` — LiDAR ZIPs + MBTiles/PMTiles output
    (`terraform output s3_bucket_topo`).
  - (The frontend SPA bucket served by CloudFront: `terraform output
    s3_bucket_frontend`.)
- `logjam-topo-jobs` has a 7-day lifecycle rule on `exports/`. It is a
  backstop; the reaper's expiry sweep is authoritative.
- `logjam-media` deliberately has **no** lifecycle rules. Orphaned unconfirmed
  uploads are swept by the in-API reaper (`api/src/lib/mediaOrphanSweeper.ts`),
  which never deletes objects backed by a confirmed `Media` row.

## CDN — CloudFront

Two distributions:

- **`web`** — `E22J79PHZM2K` (`terraform output
  web_cloudfront_distribution_id`): `logjamnsw.com`, multi-origin, serving the
  frontend SPA bucket plus topo tiles from `logjam-topo-jobs` under
  `/master/*`. This is `TOPO_CDN_BASE_URL=https://logjamnsw.com`
  (`terraform output topo_cdn_base_url`).
- **`api`** — `E29GLTTDM6CXX4` (`terraform output
  api_cloudfront_distribution_id`): `api.logjamnsw.com`, fronts the EB API.

## Email — Resend

- Resend sends transactional email on job/export/GeoPDF completion (it replaced
  AWS SES, whose production access was denied).
- API key in Secrets Manager (`logjam/resend-api-key`), injected into the three
  worker task defs as `RESEND_API_KEY`; sender
  `EMAIL_FROM=noreply@notifications.logjamnsw.com`.
- Node side: `api/src/services/email.ts` (`sendEmail`); Python workers:
  `topo/email_send.py`.
- Sends are best-effort (a no-op if the key is unset); the in-app
  `Notification` row is the source of truth.

## Auth — Cognito

- A Cognito user pool (`terraform output cognito_user_pool_id`); the API
  verifies JWTs via JWKS.

## Images — ECR

- ECR repos `logjam-api` and `logjam-topo-worker`
  (`terraform output ecr_api_repository_url`,
  `terraform output ecr_topo_worker_repository_url`).
