# ECS task definitions for the three on-demand Fargate workers, the
# pre-deploy migrate one-shot, the monthly place registry build and the
# two-hourly river gauges job. Workers are launched via RunTask
# (api/src/lib/ecsRunTask.ts), the registry and gauges by their schedules
# below; no long-running services. container_definitions
# is pinned to the exact live JSON (generated via
# `terraform plan -generate-config-out`) so the plan stays clean — editing it
# registers a new task-def revision.
#
# WHO OWNS THE IMAGE TAG. Terraform owns everything in these defs
# EXCEPT the image: after each deploy, CI registers a further revision with the
# image pinned to the commit sha it just pushed
# (infra/scripts/pin-ecs-task-image.sh, called from deploy-api.yml and
# deploy-topo-worker.yml). RunTask resolves a family to its latest ACTIVE
# revision, so CI's revision is the one that launches and Terraform's is the
# floor beneath it. That is why `terraform plan` stays clean: the provider reads
# the specific revision ARN in state, which CI never touches.
#
# The `:latest` below is therefore a floor, not the deployed tag — and applying
# a change to one of these defs registers a revision carrying that floor again,
# which is a real (if brief) un-pinning. Re-run the matching deploy workflow
# after any apply that touches a task definition.
#
# The cluster (aws_ecs_cluster) lives in ecs_cluster.tf.

resource "aws_ecs_task_definition" "api_script" {
  container_definitions = jsonencode([{
    # Always overridden by the RunTask caller; this refuses a bare start rather
    # than booting the API server with the production database credentials.
    command = ["node", "-e", "console.error('api-script needs a command override'); process.exit(1)"]
    environment = [{
      name  = "AUTH_MODE"
      value = "cognito"
      }, {
      name  = "AWS_REGION"
      value = "ap-southeast-2"
      }, {
      name  = "CORS_ORIGIN"
      value = "https://logjamnsw.com,https://www.logjamnsw.com"
      }, {
      name  = "DB_HOST"
      value = "logjam-db-enc.chwko8w4iz9p.ap-southeast-2.rds.amazonaws.com"
      }, {
      name  = "DB_NAME"
      value = "logjam"
      }, {
      name  = "DB_PORT"
      value = "5432"
      }, {
      name  = "EMAIL_FROM"
      value = "noreply@notifications.logjamnsw.com"
      }, {
      name = "ECS_SECURITY_GROUPS"
      # Dedicated worker SG. Vestigial here (a maintainer script never calls
      # RunTask) but kept in sync so no stale default-SG id lingers in a
      # committed task def. The operative value is the EB env property of the
      # same name (operator-owned).
      value = aws_security_group.worker.id
      }, {
      name  = "ECS_SUBNETS"
      value = "subnet-0f59b0845905891be,subnet-0c10e1438a8fd0231"
      }, {
      name  = "FRONTEND_URL"
      value = "https://logjamnsw.com/"
      }, {
      name  = "NODE_ENV"
      value = "production"
      }, {
      name  = "OIDC_AUDIENCE"
      value = "545ofbb8l9d1sl6ggbmk6oonn9"
      }, {
      name  = "OIDC_ISSUER"
      value = "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_x5zPhJXMk"
      }, {
      name  = "S3_BUCKET_MEDIA"
      value = "logjam-media"
      }, {
      name  = "SMTP_HOST"
      value = "smtp.resend.com"
      }, {
      name  = "SMTP_PORT"
      value = "465"
      }, {
      name  = "SMTP_USER"
      value = "resend"
      }, {
      name  = "S3_BUCKET_TOPO"
      value = "logjam-topo-jobs"
      }, {
      name  = "TOPO_CDN_BASE_URL"
      value = "https://logjamnsw.com"
    }]
    essential = true
    # Floor only — CI re-registers this def pinned to a sha (see header).
    image = "620853681701.dkr.ecr.ap-southeast-2.amazonaws.com/logjam-api:latest"
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-create-group  = "true"
        awslogs-group         = "/ecs/logjam-api-script"
        awslogs-region        = "ap-southeast-2"
        awslogs-stream-prefix = "ecs"
      }
    }
    mountPoints  = []
    name         = "api-script"
    portMappings = []
    secrets = [{
      name      = "DB_PASSWORD"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/app-db-password-bTvuYd:password::"
      }, {
      name      = "DB_USER"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/app-db-password-bTvuYd:username::"
      }, {
      name      = "SMTP_PASSWORD"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/resend-api-key-59egrs:apiKey::"
    }]
    systemControls = []
    volumesFrom    = []
  }])
  cpu                      = "1024"
  enable_fault_injection   = false
  execution_role_arn       = "arn:aws:iam::620853681701:role/ecsTaskExecutionRole"
  family                   = "logjam-api-script"
  memory                   = "4096"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  task_role_arn            = "arn:aws:iam::620853681701:role/logjam-topo-worker-role"
}

resource "aws_ecs_task_definition" "topo_worker" {
  container_definitions = jsonencode([{
    environment = [{
      name  = "AWS_REGION"
      value = "ap-southeast-2"
      }, {
      name  = "DB_HOST"
      value = "logjam-db-enc.chwko8w4iz9p.ap-southeast-2.rds.amazonaws.com"
      }, {
      name  = "DB_NAME"
      value = "logjam"
      }, {
      name  = "DB_PORT"
      value = "5432"
      }, {
      name  = "FRONTEND_URL"
      value = "https://logjamnsw.com/"
      }, {
      name  = "GDAL_DISABLE_READDIR_ON_OPEN"
      value = "EMPTY_DIR"
      }, {
      name  = "EMAIL_FROM"
      value = "noreply@notifications.logjamnsw.com"
      }, {
      name  = "SMTP_HOST"
      value = "smtp.resend.com"
      }, {
      name  = "SMTP_PORT"
      value = "465"
      }, {
      name  = "SMTP_USER"
      value = "resend"
      }, {
      name  = "S3_BUCKET_TOPO"
      value = "logjam-topo-jobs"
      }, {
      name  = "SVTM_FORMATION_S3_PATH"
      value = "s3://logjam-topo-jobs/svtm/svtm_formation.tif"
    }]
    essential = true
    # Floor only — CI re-registers this def pinned to a sha (see header).
    image = "620853681701.dkr.ecr.ap-southeast-2.amazonaws.com/logjam-topo-worker:latest"
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-create-group  = "true"
        awslogs-group         = "/ecs/logjam-topo-worker"
        awslogs-region        = "ap-southeast-2"
        awslogs-stream-prefix = "ecs"
      }
    }
    mountPoints  = []
    name         = "topo-worker"
    portMappings = []
    secrets = [{
      name      = "DB_PASSWORD"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/app-db-password-bTvuYd:password::"
      }, {
      name      = "DB_USER"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/app-db-password-bTvuYd:username::"
      }, {
      name      = "SMTP_PASSWORD"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/resend-api-key-59egrs:apiKey::"
    }]
    systemControls = []
    volumesFrom    = []
  }])
  cpu                      = "8192"
  enable_fault_injection   = false
  execution_role_arn       = "arn:aws:iam::620853681701:role/ecsTaskExecutionRole"
  family                   = "logjam-topo-worker"
  memory                   = "16384"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  task_role_arn            = "arn:aws:iam::620853681701:role/logjam-topo-worker-role"

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
}

# One-shot task that runs `prisma migrate deploy` against RDS as the least-priv
# logjam_app role (same logjam/app-db-password secret + logjam-api image the EB
# container uses at boot). The deploy workflow (.github/workflows/deploy-api.yml)
# RunTasks this BEFORE the EB version swap and gates the deploy on its exit code:
# a failing migration aborts the deploy and the old version keeps serving,
# instead of crash-looping the new container at boot. No task role — migrate
# makes no AWS API calls; secret injection is the execution role's job. Runs on
# the dedicated worker SG so RDS ingress admits it.
resource "aws_ecs_task_definition" "api_migrate" {
  container_definitions = jsonencode([{
    command = ["npx", "prisma", "migrate", "deploy"]
    environment = [{
      name  = "AWS_REGION"
      value = "ap-southeast-2"
      }, {
      name  = "DB_HOST"
      value = "logjam-db-enc.chwko8w4iz9p.ap-southeast-2.rds.amazonaws.com"
      }, {
      name  = "DB_NAME"
      value = "logjam"
      }, {
      name  = "DB_PORT"
      value = "5432"
      }, {
      name  = "NODE_ENV"
      value = "production"
    }]
    essential = true
    # Floor only — CI re-registers this def pinned to a sha (see header).
    image = "620853681701.dkr.ecr.ap-southeast-2.amazonaws.com/logjam-api:latest"
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        # awslogs-create-group is OMITTED (ECS rejects "false" — it may only be
        # "true" or absent). The group is pre-created in logging.tf
        # (aws_cloudwatch_log_group.api_migrate) because ecsTaskExecutionRole
        # lacks logs:CreateLogGroup; the driver just writes to the existing group.
        awslogs-group         = "/ecs/logjam-api-migrate"
        awslogs-region        = "ap-southeast-2"
        awslogs-stream-prefix = "ecs"
      }
    }
    mountPoints  = []
    name         = "api-migrate"
    portMappings = []
    secrets = [{
      name      = "DB_PASSWORD"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/app-db-password-bTvuYd:password::"
      }, {
      name      = "DB_USER"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/app-db-password-bTvuYd:username::"
    }]
    systemControls = []
    volumesFrom    = []
  }])
  cpu                      = "512"
  enable_fault_injection   = false
  execution_role_arn       = "arn:aws:iam::620853681701:role/ecsTaskExecutionRole"
  family                   = "logjam-api-migrate"
  memory                   = "1024"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
}

resource "aws_ecs_task_definition" "topo_export_worker" {
  container_definitions = jsonencode([{
    entryPoint = ["python3", "/app/export_worker.py"]
    environment = [{
      name  = "AWS_REGION"
      value = "ap-southeast-2"
      }, {
      name  = "DB_HOST"
      value = "logjam-db-enc.chwko8w4iz9p.ap-southeast-2.rds.amazonaws.com"
      }, {
      name  = "DB_NAME"
      value = "logjam"
      }, {
      name  = "DB_PORT"
      value = "5432"
      }, {
      name  = "EMAIL_FROM"
      value = "noreply@notifications.logjamnsw.com"
      }, {
      name  = "FRONTEND_URL"
      value = "https://logjamnsw.com/"
      }, {
      name  = "SMTP_HOST"
      value = "smtp.resend.com"
      }, {
      name  = "SMTP_PORT"
      value = "465"
      }, {
      name  = "SMTP_USER"
      value = "resend"
      }, {
      name  = "S3_BUCKET_TOPO"
      value = "logjam-topo-jobs"
    }]
    essential = true
    # Floor only — CI re-registers this def pinned to a sha (see header).
    image = "620853681701.dkr.ecr.ap-southeast-2.amazonaws.com/logjam-topo-worker:latest"
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-create-group  = "true"
        awslogs-group         = "/ecs/logjam-topo-export-worker"
        awslogs-region        = "ap-southeast-2"
        awslogs-stream-prefix = "ecs"
      }
    }
    mountPoints  = []
    name         = "topo-export-worker"
    portMappings = []
    secrets = [{
      name      = "DB_PASSWORD"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/app-db-password-bTvuYd:password::"
      }, {
      name      = "DB_USER"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/app-db-password-bTvuYd:username::"
      }, {
      name      = "SMTP_PASSWORD"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/resend-api-key-59egrs:apiKey::"
    }]
    systemControls = []
    volumesFrom    = []
  }])
  cpu                      = "4096"
  enable_fault_injection   = false
  execution_role_arn       = "arn:aws:iam::620853681701:role/ecsTaskExecutionRole"
  family                   = "logjam-topo-export-worker"
  memory                   = "8192"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  task_role_arn            = "arn:aws:iam::620853681701:role/logjam-topo-worker-role"

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
}

# The OpenStreetMap place registry: once a month, download Geofabrik's NSW
# extract, build the registry and publish it under master/places/ in the topo
# bucket, where CloudFront serves it publicly beside the DEM. Why a scheduled
# ECS task with its own write role, and not a CI cron:
# docs/decisions/0034-location-search-reads-a-public-osm-place-registry.md.
# Same image as the topo workers, so pin-release.sh repins it on each topo
# deploy; no database and no secrets.
resource "aws_ecs_task_definition" "place_registry" {
  container_definitions = jsonencode([{
    entryPoint = ["python3", "/app/build_place_registry.py", "publish"]
    environment = [{
      name  = "AWS_REGION"
      value = "ap-southeast-2"
      }, {
      name  = "S3_BUCKET_TOPO"
      value = module.topo_jobs.bucket_id
    }]
    essential = true
    # Floor only — CI re-registers this def pinned to a sha (see header).
    image = "620853681701.dkr.ecr.ap-southeast-2.amazonaws.com/logjam-topo-worker:latest"
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        # Pre-created in logging.tf; see api_migrate for why the
        # create-group option is absent.
        awslogs-group         = aws_cloudwatch_log_group.place_registry.name
        awslogs-region        = "ap-southeast-2"
        awslogs-stream-prefix = "ecs"
      }
    }
    name = "place-registry"
  }])
  # About 1.3 GB peak and 80 s of build on the October 2026 extract.
  cpu                      = "1024"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  family                   = "logjam-place-registry"
  memory                   = "3072"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  task_role_arn            = aws_iam_role.place_registry.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
}

# 04:00 Sydney on the 5th of each month. The task definition is named by
# family, without a revision, so RunTask launches the latest ACTIVE revision:
# the one CI pinned to the current topo image, not Terraform's `:latest` floor.
# Failures and launches that never happen alarm in monitoring.tf.
resource "aws_scheduler_schedule" "place_registry" {
  name                         = "logjam-place-registry"
  schedule_expression          = "cron(0 4 5 * ? *)"
  schedule_expression_timezone = "Australia/Sydney"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.place_registry_scheduler.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.place_registry.arn_without_revision
      launch_type         = "FARGATE"

      # As api/src/lib/ecsRunTask.ts launches the workers: a public IP is
      # the task's only way out to Geofabrik and S3.
      network_configuration {
        subnets          = [data.aws_subnet.worker_a.id, data.aws_subnet.worker_b.id]
        security_groups  = [aws_security_group.worker.id]
        assign_public_ip = true
      }
    }
  }
}

# River gauges (ADR 0044): every two hours, read WaterNSW's latest levels and
# flows and publish them under master/gauges/ in the topo bucket; once a day
# also extend each gauge's history from the Bureau of Meteorology. Same image
# as the topo workers, so pin-release.sh repins it on each topo deploy. No
# database; its one secret is WaterNSW's API key, whose value is set by hand.
resource "aws_secretsmanager_secret" "waternsw_api_key" {
  name        = "logjam/waternsw-api-key"
  description = "WaterNSW Water Data API subscription key (Basic tier, 29 calls a day). Read by the logjam-gauges task. Value set by hand, never in Terraform."
}

resource "aws_ecs_task_definition" "gauges" {
  container_definitions = jsonencode([{
    entryPoint = ["python3", "/app/build_gauges.py", "run"]
    environment = [{
      name  = "AWS_REGION"
      value = "ap-southeast-2"
      }, {
      name  = "S3_BUCKET_TOPO"
      value = module.topo_jobs.bucket_id
    }]
    essential = true
    # Floor only — CI re-registers this def pinned to a sha (see header).
    image = "620853681701.dkr.ecr.ap-southeast-2.amazonaws.com/logjam-topo-worker:latest"
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.gauges.name
        awslogs-region        = "ap-southeast-2"
        awslogs-stream-prefix = "ecs"
      }
    }
    name = "gauges"
    secrets = [{
      name      = "WATERNSW_API_KEY"
      valueFrom = aws_secretsmanager_secret.waternsw_api_key.arn
    }]
  }])
  # The smallest Fargate size: the job holds a few hundred readings and, on
  # the daily sweep, one gauge's history at a time. Its time goes in waiting
  # on the APIs' rate limits, not in CPU or memory.
  cpu                      = "256"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  family                   = "logjam-gauges"
  memory                   = "512"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  task_role_arn            = aws_iam_role.gauges.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
}

# Its own schedule group: the not-launched alarm's only dimension is the group
# (see monitoring.tf), so a shared group would mix this schedule's errors with
# the place registry's.
resource "aws_scheduler_schedule_group" "gauges" {
  name = "logjam-gauges"
}

# Every two hours; build_gauges.py's RUNS_PER_DAY and the 29-calls-a-day quota
# assume it (guard: topo/tests/test_gauges.py).
resource "aws_scheduler_schedule" "gauges" {
  name                = "logjam-gauges"
  group_name          = aws_scheduler_schedule_group.gauges.name
  schedule_expression = "rate(2 hours)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.gauges_scheduler.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.gauges.arn_without_revision
      launch_type         = "FARGATE"

      network_configuration {
        subnets          = [data.aws_subnet.worker_a.id, data.aws_subnet.worker_b.id]
        security_groups  = [aws_security_group.worker.id]
        assign_public_ip = true
      }
    }
  }
}
