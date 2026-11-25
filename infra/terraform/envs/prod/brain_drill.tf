# The daily restore drill: a Fargate task that restores the newest backup onto
# its own scratch disk, starts Postgres there with archiving off, reads every
# table, and writes drill.json to the signals bucket. The watchdog fails when
# that file is missing, older than 50 hours or not ok (brain_watchdog.tf). What
# the script does: infra/brain/postgres/drill.sh.
#
# Everything here exists only while the instance does (brain_instance.tf).
# Guards: tests/guards.tftest.hcl (brain_drill_*).

# Not subscribed to the audit stream (brain_logs.tf's Firehose filter): a
# drill's log is not prod's audit trail. Guard: brain_drill_log_is_not_the_audit_trail.
resource "aws_cloudwatch_log_group" "brain_drill" {
  count = local.brain_enabled ? 1 : 0

  name              = "/logjam/brain/drill"
  retention_in_days = local.operational_log_retention_days
}

# No ingress: the drill never connects to the brain's Postgres, so it needs no
# rule on either side. Egress is S3 and ECR over the internet gateway, as the
# other tasks'.
resource "aws_security_group" "brain_drill" {
  count = local.brain_enabled ? 1 : 0

  name        = "logjam-brain-drill-sg"
  description = "The brain restore drill: no ingress, egress to S3 and ECR"
  vpc_id      = data.aws_vpc.main.id

  # Stated, not left out, so a rule added by hand is removed at the next apply
  # and the guard can read it.
  ingress = []

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_iam_role" "brain_drill" {
  count = local.brain_enabled ? 1 : 0

  name = "logjam-brain-drill"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# The task role holds a full copy of the database and must not be able to touch
# the repository it restored from: read-only on the backup bucket (no
# PutObject, DeleteObject or version listing), one object writable in the
# signals bucket. Guard: brain_drill_role_cannot_write_the_backups.
resource "aws_iam_role_policy" "brain_drill" {
  count = local.brain_enabled ? 1 : 0

  name = "logjam-brain-drill"
  role = aws_iam_role.brain_drill[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadBackups"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.brain_backups.arn}/*"
      },
      {
        Sid      = "ListBackups"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.brain_backups.arn
      },
      {
        Sid      = "WriteVerdict"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.brain_signals.arn}/drill.json"
      },
    ]
  })
}

resource "aws_ecs_task_definition" "brain_drill" {
  count = local.brain_enabled ? 1 : 0

  family                   = "logjam-brain-drill"
  cpu                      = "1024"
  memory                   = "2048"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.brain_drill[0].arn

  # Must hold the restored database and its WAL replay: raise the variable
  # before the database passes half of it.
  ephemeral_storage {
    size_in_gib = var.brain_drill_storage_gb
  }

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name      = "drill"
    image     = "${aws_ecr_repository.brain_postgres.repository_url}:${var.brain_pg_image_tag}"
    command   = ["/usr/local/lib/brain/drill.sh"]
    essential = true
    environment = [
      { name = "AWS_REGION", value = "ap-southeast-2" },
      { name = "BRAIN_BACKUP_BUCKET", value = aws_s3_bucket.brain_backups.bucket },
      { name = "BRAIN_SIGNALS_BUCKET", value = aws_s3_bucket.brain_signals.bucket },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.brain_drill[0].name
        awslogs-region        = "ap-southeast-2"
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

# What EventBridge Scheduler assumes to start the drill: RunTask on that one
# family in the one cluster, passing only the two roles it needs.
resource "aws_iam_role" "brain_drill_scheduler" {
  count = local.brain_enabled ? 1 : 0

  name = "logjam-brain-drill-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = "620853681701" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "brain_drill_scheduler" {
  count = local.brain_enabled ? 1 : 0

  name = "logjam-brain-drill-runtask"
  role = aws_iam_role.brain_drill_scheduler[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RunBrainDrillTask"
        Effect = "Allow"
        Action = "ecs:RunTask"
        Resource = [
          aws_ecs_task_definition.brain_drill[0].arn_without_revision,
          "${aws_ecs_task_definition.brain_drill[0].arn_without_revision}:*",
        ]
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn }
        }
      },
      {
        Sid    = "PassBrainDrillRoles"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          aws_iam_role.ecs_task_execution.arn,
          aws_iam_role.brain_drill[0].arn,
        ]
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
    ]
  })
}

# 04:30 Sydney every day, after the 03:00 full backup, so the first verdict
# exists within a day of bring-up. A drill that fails, or never starts, shows
# as the watchdog's drill_failed, drill_stale or drill_missing.
resource "aws_scheduler_schedule" "brain_drill" {
  count = local.brain_enabled ? 1 : 0

  name                         = "logjam-brain-drill"
  schedule_expression          = "cron(30 4 * * ? *)"
  schedule_expression_timezone = "Australia/Sydney"
  state                        = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.brain_drill_scheduler[0].arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.brain_drill[0].arn_without_revision
      launch_type         = "FARGATE"

      network_configuration {
        subnets          = [data.aws_subnet.worker_a.id, data.aws_subnet.worker_b.id]
        security_groups  = [aws_security_group.brain_drill[0].id]
        assign_public_ip = true
      }
    }
  }
}
