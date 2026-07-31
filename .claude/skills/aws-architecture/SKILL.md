---
name: aws-architecture
description: Logjam's prod AWS topology and operational reference — Terraform IaC layout and apply gating, Elastic Beanstalk API host, the three ECS Fargate worker task defs and how the API launches them, the two S3 buckets and their lifecycle/reaper split, both CloudFront distributions, Resend transactional email, Cognito, ECR, and the aws CLI one-liners for logs/task state/SSM/S3. Use when working on deploys, infra/terraform, worker launches, S3 or CloudFront behaviour, prod debugging, or any question about what runs where in AWS.
---

# AWS architecture — Logjam prod

All AWS CLI calls: **always `--profile logjam --region ap-southeast-2`**.
Never run prod-targeted commands without explicit user confirmation.

## Topology

- **IaC = Terraform** (`infra/terraform/`, see its README). Single source of truth for prod AWS; the `envs/local` root reuses the same `storage` module for MiniStack S3 and adds `ecs.tf` (cluster + worker task defs) so MiniStack RunTask launches workers locally. All resources below were imported, not recreated. Prod root `envs/prod` (S3 backend); `terraform output` gives canonical values. RDS/Cognito/CloudFront/EB carry `prevent_destroy`. CI still owns deploys (EB env ignores `setting`; task defs ride `:latest`). Infra PRs get `fmt`/`validate` (`terraform-ci.yml`) plus a read-only prod `terraform plan` posted as a PR comment (`terraform-plan.yml` — CI role is ReadOnlyAccess with a privacy Deny on user-data object reads/secret values); `terraform apply` stays manual, operator-gated.
- **VPC-bound:** data-plane access needs SSM Session Manager, not SSH.
- **Elastic Beanstalk** runs API (single Docker container via `api/Dockerrun.aws.json`; image from ECR `logjam-api`).
- **ECS Fargate** runs the on-demand workers — three task defs: `logjam-topo-worker` and `logjam-topo-export-worker` (one Python image with a command override, see `topo/Dockerfile`), plus `logjam-geo-pdf-worker` (the `logjam-api` Node image with command override `node dist/worker/geoPdfWorker.js`; defined by `aws_ecs_task_definition.geo_pdf_worker` in `infra/terraform/envs/prod/ecs.tf`). Launched on-demand by API via the shared `api/src/lib/ecsRunTask.ts` helper (`RunTaskCommand` + placement-failure check) with a job-ID env var (`JOB_ID` / `EXPORT_JOB_ID` / `GEO_PDF_JOB_ID`). Lifecycle owned by ECS; retry semantics owned by the `TopoJob`/`TopoExportJob`/`GeoPdfJob` status columns (no SQS). Stuck jobs/exports are swept by the in-API reaper (`api/src/lib/topoJobReaper.ts`); the API stops orphaned Fargate tasks via StopTask using the persisted task ARN.
- **S3:** two buckets — `logjam-media` (photos/media) and `logjam-topo-jobs` (LiDAR ZIPs + MBTiles/PMTiles output). Presigned URLs for client upload/download. `logjam-topo-jobs` has a 7-day lifecycle rule on `exports/` (backstop; the reaper's expiry sweep is authoritative). `logjam-media` deliberately has no lifecycle rules — orphaned unconfirmed uploads are swept by the in-API reaper (`api/src/lib/mediaOrphanSweeper.ts`), which never deletes objects backed by a confirmed `Media` row.
- **CloudFront:** two distributions — `web` (E22J79PHZM2K: `logjamnsw.com`, multi-origin serving the frontend SPA bucket + topo tiles from `logjam-topo-jobs` under `/master/*`; this is `TOPO_CDN_BASE_URL=https://logjamnsw.com`) and `api` (E29GLTTDM6CXX4: `api.logjamnsw.com`, fronts the EB API).
- **Resend** for transactional email on job/export/GeoPDF completion (replaced AWS SES, whose production access was denied). API key in Secrets Manager (`logjam/resend-api-key`), injected into the three worker task defs as `RESEND_API_KEY`; sender `EMAIL_FROM=noreply@notifications.logjamnsw.com`. Node side: `api/src/services/email.ts` (`sendEmail`); Python workers: `topo/email_send.py`. Sends are best-effort (no-op if key unset); the in-app `Notification` row is the source of truth.
- **Cognito** user pool; API verifies JWT via JWKS.
- **ECR** image registry (`logjam-api`, `logjam-topo-worker`).

## One-liners

```bash
# Logs
aws logs tail /ecs/<service> --follow --profile logjam

# ECS task state
aws ecs describe-tasks --cluster <cluster> --tasks <task-arn> --profile logjam
aws ecs list-tasks --cluster <cluster> --profile logjam

# SSM into a running task
aws ecs execute-command --cluster <cluster> --task <task-arn> \
  --container <name> --interactive --command "/bin/sh" --profile logjam

# S3 listing
aws s3 ls s3://<bucket>/ --profile logjam
```
