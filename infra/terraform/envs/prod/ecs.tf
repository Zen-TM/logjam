# ECS task definitions for the three on-demand Fargate workers. Launched via
# RunTask (api/src/lib/ecsRunTask.ts), no long-running services. CI pushes new
# images to ECR; the task defs reference :latest, so CI image pushes flow
# through without re-registering here. container_definitions is pinned to the
# exact live JSON (generated via `terraform plan -generate-config-out`) so the
# plan stays clean — editing it registers a new task-def revision.
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
      name  = "ECS_SECURITY_GROUPS"
      value = "sg-0543d2bbce86b5d2a"
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
    image     = "620853681701.dkr.ecr.ap-southeast-2.amazonaws.com/logjam-api:latest"
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
    image     = "620853681701.dkr.ecr.ap-southeast-2.amazonaws.com/logjam-topo-worker:latest"
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
  cpu                      = "4096"
  enable_fault_injection   = false
  execution_role_arn       = "arn:aws:iam::620853681701:role/ecsTaskExecutionRole"
  family                   = "logjam-topo-worker"
  memory                   = "8192"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  task_role_arn            = "arn:aws:iam::620853681701:role/logjam-topo-worker-role"

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
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
    image     = "620853681701.dkr.ecr.ap-southeast-2.amazonaws.com/logjam-topo-worker:latest"
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
