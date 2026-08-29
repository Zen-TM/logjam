# ECS task definitions for the three on-demand Fargate workers, plus the
# pre-deploy migrate one-shot. Launched via RunTask
# (api/src/lib/ecsRunTask.ts), no long-running services. container_definitions
# is pinned to the exact live JSON (generated via
# `terraform plan -generate-config-out`) so the plan stays clean — editing it
# registers a new task-def revision.
#
# WHO OWNS THE IMAGE TAG (INF-009). Terraform owns everything in these defs
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
# The cluster (aws_ecs_cluster) lives in ecs_cluster.tf, added after its
# CloudFormation stack is retired.

resource "aws_ecs_task_definition" "geo_pdf_worker" {
  container_definitions = jsonencode([{
    command = ["node", "dist/worker/geoPdfWorker.js"]
    environment = [{
      name  = "AUTH_MODE"
      value = "cognito"
      }, {
      name  = "AWS_REGION"
      value = "ap-southeast-2"
      }, {
      name  = "COGNITO_CLIENT_ID"
      value = "545ofbb8l9d1sl6ggbmk6oonn9"
      }, {
      name  = "COGNITO_REGION"
      value = "ap-southeast-2"
      }, {
      name  = "COGNITO_USER_POOL_ID"
      value = "ap-southeast-2_x5zPhJXMk"
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
      # CP-003: dedicated worker SG (was the VPC default sg-0543d2bbce86b5d2a).
      # Vestigial here (geoPdfWorker is a leaf, never calls RunTask) but kept in
      # sync so no stale default-SG id lingers in a committed task def. The
      # operative value is the EB env property of the same name (operator-owned).
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
      name  = "S3_BUCKET_MEDIA"
      value = "logjam-media"
      }, {
      name  = "S3_BUCKET_TOPO"
      value = "logjam-topo-jobs"
      }, {
      name  = "TOPO_CDN_BASE_URL"
      value = "https://logjamnsw.com"
    }]
    essential = true
    # Floor only — CI re-registers this def pinned to a sha (INF-009, header).
    image = "620853681701.dkr.ecr.ap-southeast-2.amazonaws.com/logjam-api:latest"
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-create-group  = "true"
        awslogs-group         = "/ecs/logjam-geo-pdf-worker"
        awslogs-region        = "ap-southeast-2"
        awslogs-stream-prefix = "ecs"
      }
    }
    mountPoints  = []
    name         = "geo-pdf-worker"
    portMappings = []
    secrets = [{
      name      = "DB_PASSWORD"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/app-db-password-bTvuYd:password::"
      }, {
      name      = "DB_USER"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/app-db-password-bTvuYd:username::"
      }, {
      name      = "RESEND_API_KEY"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/resend-api-key-59egrs:apiKey::"
    }]
    systemControls = []
    volumesFrom    = []
  }])
  cpu                      = "1024"
  enable_fault_injection   = false
  execution_role_arn       = "arn:aws:iam::620853681701:role/ecsTaskExecutionRole"
  family                   = "logjam-geo-pdf-worker"
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
      name  = "S3_BUCKET_TOPO"
      value = "logjam-topo-jobs"
      }, {
      name  = "SVTM_FORMATION_S3_PATH"
      value = "s3://logjam-topo-jobs/svtm/svtm_formation.tif"
    }]
    essential = true
    # Floor only — CI re-registers this def pinned to a sha (INF-009, header).
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
    mountPoints = []
    name        = "topo-worker"
    portMappings = [{
      appProtocol   = "http"
      containerPort = 80
      hostPort      = 80
      name          = "topo-worker-80-tcp"
      protocol      = "tcp"
    }]
    secrets = [{
      name      = "DB_PASSWORD"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/app-db-password-bTvuYd:password::"
      }, {
      name      = "DB_USER"
      valueFrom = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/app-db-password-bTvuYd:username::"
      }, {
      name      = "RESEND_API_KEY"
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
# container used at boot). The deploy workflow (.github/workflows/deploy-api.yml)
# RunTasks this BEFORE the EB version swap and gates the deploy on its exit code
# (ARCH-001 half B): a failing migration aborts the deploy and the old version
# keeps serving, instead of crash-looping the new container at boot. No task
# role — migrate makes no AWS API calls; secret injection is the execution
# role's job. Runs on the dedicated worker SG so RDS ingress (CP-003) admits it.
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
    # Floor only — CI re-registers this def pinned to a sha (INF-009, header).
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
      name  = "S3_BUCKET_TOPO"
      value = "logjam-topo-jobs"
    }]
    essential = true
    # Floor only — CI re-registers this def pinned to a sha (INF-009, header).
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
      name      = "RESEND_API_KEY"
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
