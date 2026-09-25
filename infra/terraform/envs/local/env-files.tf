# Generate the repo-root .env.local from the shared template. This makes
# Terraform the producer of the dev env file, killing the manual two-file drift
# (.env.local vs api/.env). The file is gitignored; regenerated every apply.
locals {
  repo_root = abspath("${path.module}/../../../..")
}

resource "local_file" "env_local" {
  filename = "${local.repo_root}/.env.local"
  content = templatefile("${path.module}/../../templates/env.local.tftpl", {
    auth_mode     = "fake"
    fake_user_sub = "fake-alice-sub"

    cognito_user_pool_id = var.cognito_user_pool_id
    cognito_client_id    = var.cognito_client_id
    cognito_region       = "ap-southeast-2"

    db_host     = "localhost"
    db_port     = "5432"
    db_name     = "logjam"
    db_user     = "logjam"
    db_password = "logjam"

    aws_endpoint_url      = "http://localhost:4566"
    aws_region            = "ap-southeast-2"
    aws_access_key_id     = "test"
    aws_secret_access_key = "test"

    s3_bucket_media        = module.media.bucket_id
    s3_bucket_topo         = module.topo.bucket_id
    svtm_formation_s3_path = "s3://${module.topo.bucket_id}/svtm/svtm_formation.tif"

    port              = "8080"
    node_env          = "development"
    cors_origin       = "http://localhost:5173"
    topo_cdn_base_url = "http://localhost:4566/${module.topo.bucket_id}"

    protomaps_archive_uri = var.protomaps_archive_uri

    # Dummy non-empty VPC config flips the ECS_SUBNETS_LIST guard on, so the API
    # launches worker tasks via MiniStack RunTask locally. MiniStack ignores the
    # subnet/SG values (it runs the container on DOCKER_NETWORK).
    ecs_subnets         = "subnet-local"
    ecs_security_groups = "sg-local"
  })
}
