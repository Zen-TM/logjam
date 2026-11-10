# The cutover's data copy (#434): a Fargate task that dumps RDS and restores
# into the brain, run BY HAND (once or twice as a dress rehearsal, then in the
# cutover window). infra/brain/postgres/copy.sh refuses a serving brain, so a
# rehearsal can never overwrite live data.
#
# It has no schedule and nothing may give it one: a scheduled copy after the
# cutover would replace the live database with RDS's frozen copy. Guard:
# tests/guards.tftest.hcl (brain_copy_is_never_scheduled).
#
# It runs on the worker security group in the worker subnets, as the migrate
# task does (ecs.tf; deploy-api.yml names both): logjam-worker-sg is already
# the source of the RDS ingress rule (network.tf) and of the brain's 5432 rule
# (brain_network.tf), so no rule is added. The task needs a public IP, as every
# worker does, to fetch Amazon's RDS CA bundle and pull its image.
#
# Start (dress rehearsal; add COPY_REPLACE=1 to a later run over an earlier copy).
# RDS is live outside the cutover window, and the copy stops on a source that
# is not read-only unless COPY_ALLOW_LIVE_SOURCE=1: a rehearsal carries it, the
# window's copy does not (docs/operations/brain-cutover.md has the commands).
#   aws ecs run-task --cluster logjam-cluster --launch-type FARGATE \
#     --task-definition logjam-brain-copy \
#     --overrides '{"containerOverrides":[{"name":"brain-copy","environment":[{"name":"COPY_ALLOW_LIVE_SOURCE","value":"1"}]}]}' \
#     --network-configuration "awsvpcConfiguration={subnets=[<worker subnets>],securityGroups=[<logjam-worker-sg>],assignPublicIp=ENABLED}"
locals {
  # infra/brain/brain-ca.pem is committed once the brain has booted and made
  # its certificate. Until then the task still plans, and the script stops for
  # want of a CA.
  brain_ca_file = "${local.brain_dir}/brain-ca.pem"
  brain_copy_ca = fileexists(local.brain_ca_file) ? file(local.brain_ca_file) : ""
}

# A group of its own, not subscribed to the audit Firehose (brain_logs.tf):
# the script prints table names and counts only, and the audit trail records
# the restore on the brain's own Postgres log.
resource "aws_cloudwatch_log_group" "brain_copy" {
  count = local.brain_enabled ? 1 : 0

  name              = "/ecs/logjam-brain-copy"
  retention_in_days = local.operational_log_retention_days
}

# The task's own role: it reads status.json (to refuse a serving brain) and
# nothing else. The execution role (ecs.tf's other tasks) injects the database
# credentials and pulls the image. Guard: brain_copy_task_reads_only_status_json.
resource "aws_iam_role" "brain_copy" {
  count = local.brain_enabled ? 1 : 0

  name = "logjam-brain-copy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "brain_copy" {
  count = local.brain_enabled ? 1 : 0

  name = "logjam-brain-copy"
  role = aws_iam_role.brain_copy[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadStatus"
      Effect   = "Allow"
      Action   = "s3:GetObject"
      Resource = "${aws_s3_bucket.brain_signals.arn}/status.json"
    }]
  })
}

resource "aws_ecs_task_definition" "brain_copy" {
  count = local.brain_enabled ? 1 : 0

  family                   = "logjam-brain-copy"
  cpu                      = "2048"
  memory                   = "4096"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.brain_copy[0].arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name      = "brain-copy"
    image     = "${aws_ecr_repository.brain_postgres.repository_url}:${var.brain_pg_image_tag}"
    command   = ["/usr/local/lib/brain/copy.sh"]
    essential = true
    environment = [
      { name = "AWS_REGION", value = "ap-southeast-2" },
      { name = "COPY_SOURCE_HOST", value = aws_db_instance.main.address },
      { name = "COPY_TARGET_HOST", value = aws_eip.brain[0].public_dns },
      { name = "COPY_TARGET_CA", value = local.brain_copy_ca },
      { name = "DB_NAME", value = "logjam" },
      { name = "BRAIN_SIGNALS_BUCKET", value = aws_s3_bucket.brain_signals.bucket },
    ]
    # The role and password of both databases: logjam_app, as the migrate task.
    secrets = [
      { name = "DB_USER", valueFrom = "${aws_secretsmanager_secret.app_db.arn}:username::" },
      { name = "DB_PASSWORD", valueFrom = "${aws_secretsmanager_secret.app_db.arn}:password::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.brain_copy[0].name
        awslogs-region        = "ap-southeast-2"
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}
