# Local ECS cluster + worker task definitions, registered into MiniStack so the
# API's RunTask path (api/src/lib/ecsRunTask.ts) launches real worker containers
# locally — the same flow as prod (infra/terraform/envs/prod/ecs.tf), adapted:
#
#   - image  → locally-built tags (see `make build-workers`), not ECR URIs.
#   - DB_HOST → `postgres` (compose DNS); workers join the `logjam-local` network
#     that MiniStack launches them on (DOCKER_NETWORK in docker-compose.yml).
#   - DB creds → plain env (local Postgres logjam/logjam), no Secrets Manager.
#   - dropped: awslogs logConfiguration, IAM role ARNs (MiniStack runs the image
#     directly via the Docker socket and ignores Fargate placement/roles).
#
# AWS_ENDPOINT_URL + credentials are auto-injected into each task by MiniStack at
# RunTask time, so the in-task SDKs reach S3/SES through MiniStack without being
# set here. Do NOT hardcode `localhost` — workers run on the network, not the host.

resource "aws_ecs_cluster" "local" {
  name = "logjam-cluster" # matches ECS_CLUSTER default in api/src/lib/env.ts
}

locals {
  # Shared by all three workers. In-network hostnames (postgres / ministack).
  worker_common_env = [
    { name = "AWS_REGION", value = "ap-southeast-2" },
    # Explicit dummy creds: MiniStack injects AWS_CONTAINER_CREDENTIALS_FULL_URI
    # on a private docker IP, which the AWS SDK v3 refuses over non-loopback HTTP.
    # env creds take precedence in the chain; AWS_ENDPOINT_URL still routes to
    # MiniStack. Same dummy creds used everywhere else in local dev.
    { name = "AWS_ACCESS_KEY_ID", value = "test" },
    { name = "AWS_SECRET_ACCESS_KEY", value = "test" },
    { name = "DB_HOST", value = "postgres" },
    { name = "DB_PORT", value = "5432" },
    { name = "DB_NAME", value = "logjam" },
    { name = "DB_USER", value = "logjam" },
    { name = "DB_PASSWORD", value = "logjam" },
    { name = "S3_BUCKET_TOPO", value = module.topo.bucket_id },
    # RESEND_API_KEY blank by default → email_send.py / services/email.ts no-op
    # (no real sends in local dev). Set TF_VAR_resend_api_key + TF_VAR_email_from
    # to test real sends — see variables.tf.
    { name = "EMAIL_FROM", value = var.email_from },
    { name = "RESEND_API_KEY", value = var.resend_api_key },
    { name = "FRONTEND_URL", value = "http://localhost:5173/" },
  ]
}

resource "aws_ecs_task_definition" "topo_worker" {
  family = "logjam-topo-worker"
  container_definitions = jsonencode([{
    name      = "topo-worker"
    image     = "logjam-topo-worker:latest"
    essential = true
    environment = concat(local.worker_common_env, [
      { name = "GDAL_DISABLE_READDIR_ON_OPEN", value = "EMPTY_DIR" },
      { name = "SVTM_FORMATION_S3_PATH", value = "s3://${module.topo.bucket_id}/svtm/svtm_formation.tif" },
    ])
  }])
  cpu                      = "4096"
  memory                   = "8192"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
}

resource "aws_ecs_task_definition" "topo_export_worker" {
  family = "logjam-topo-export-worker"
  container_definitions = jsonencode([{
    name        = "topo-export-worker"
    image       = "logjam-topo-worker:latest"
    essential   = true
    entryPoint  = ["python3", "/app/export_worker.py"]
    environment = local.worker_common_env
  }])
  cpu                      = "4096"
  memory                   = "8192"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
}

resource "aws_ecs_task_definition" "geo_pdf_worker" {
  family = "logjam-geo-pdf-worker"
  container_definitions = jsonencode([{
    name      = "geo-pdf-worker"
    image     = "logjam-api:latest"
    essential = true
    command   = ["node", "dist/worker/geoPdfWorker.js"]
    environment = concat(local.worker_common_env, [
      { name = "S3_BUCKET_MEDIA", value = module.media.bucket_id },
      { name = "TOPO_CDN_BASE_URL", value = "http://ministack:4566/${module.topo.bucket_id}" },
      { name = "AUTH_MODE", value = "fake" },
      { name = "FAKE_USER_SUB", value = "fake-alice-sub" },
      { name = "NODE_ENV", value = "development" },
      { name = "CORS_ORIGIN", value = "http://localhost:5173" },
      # Prod image bundles the RDS CA → prisma.ts would force TLS; local Postgres
      # has no SSL. Force a plain connection (see api/src/services/prisma.ts).
      { name = "DATABASE_SSL", value = "disable" },
    ])
  }])
  cpu                      = "1024"
  memory                   = "4096"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
}
