# Networking. The VPC and its subnets pre-exist and are shared infrastructure —
# referenced as data, not managed (Terraform only needs their IDs to feed the
# worker env in M6). sg-0543d2bbce86b5d2a is this VPC's DEFAULT security group,
# used for Fargate ENI placement (ECS_SECURITY_GROUPS). It's adopted via
# aws_default_security_group, which manages the default SG's rules in place
# (it never creates or deletes the SG itself).

data "aws_vpc" "main" {
  id = "vpc-0a03bc967f9e3969d"
}

data "aws_subnet" "worker_a" {
  id = "subnet-0f59b0845905891be"
}

data "aws_subnet" "worker_b" {
  id = "subnet-0c10e1438a8fd0231"
}

resource "aws_default_security_group" "default" {
  vpc_id = data.aws_vpc.main.id

  # All traffic from members of this same SG (classic default-SG self rule).
  ingress {
    protocol  = "-1"
    self      = true
    from_port = 0
    to_port   = 0
  }

  # All outbound.
  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Dedicated Fargate worker security group (logjam-worker-sg). CP-003: the RDS
# ingress below previously sourced the VPC DEFAULT SG (sg-0543d2bbce86b5d2a) as
# its "worker SG". The default SG is auto-attached to ANY resource launched into
# the VPC without an explicit SG, so "allow the workers" effectively meant "allow
# anything that landed in the default SG" — broader than the worker fleet. This
# purpose-named SG replaces it: it is attached to the three Fargate worker ENIs
# at RunTask time (awsvpcConfiguration, driven by the ECS_SECURITY_GROUPS env),
# and the RDS ingress references it instead of the default. No ingress rules —
# workers only make outbound connections; egress-all lets them reach RDS, S3,
# Secrets Manager, ECR and Resend over the internet gateway (tasks run with
# assignPublicIp=ENABLED, see api/src/lib/ecsRunTask.ts).
#
# ROLLOUT — the RDS repoint below MUST NOT be applied one-shot without moving the
# running worker fleet to this SG first, or in-flight tasks launched with the old
# default SG lose DB reachability. The operative SG is the EB env property
# ECS_SECURITY_GROUPS (EB/CI-owned, not in this repo), passed at RunTask by the
# API. Ordered operator sequence (exact commands in the cloud-posture fix report):
#   1. Apply ONLY this aws_security_group.worker (terraform apply -target) so
#      logjam-worker-sg exists.
#   2. Set the EB env property ECS_SECURITY_GROUPS to the new SG id, redeploy the
#      API, and update scripts/geo-pdf-worker-task-def.json; confirm new worker
#      tasks launch on logjam-worker-sg and reach RDS.
#   3. Apply the RDS ingress repoint below (drops the default-SG source) +
#      the geo_pdf task-def env change in ecs.tf.
resource "aws_security_group" "worker" {
  name        = "logjam-worker-sg"
  description = "Fargate worker ENIs (topo/export/geo-pdf) — RDS ingress source"
  vpc_id      = data.aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Dedicated RDS security group (logjam-db-sg). Allows Postgres (5432) from the
# EB instance SG (sg-016b93b75c584bd70, EB-managed) and from the dedicated
# Fargate worker SG (aws_security_group.worker, CP-003 — replaced the VPC
# default SG). Both referenced by id. Least-privilege: only the API + worker
# compute, NOT the whole VPC CIDR (CP-005) and NOT the account-default SG
# (CP-003). This is the SG attached to aws_db_instance.main.
resource "aws_security_group" "rds" {
  name        = "logjam-db-sg"
  description = "Created by RDS management console"
  vpc_id      = data.aws_vpc.main.id

  ingress {
    description     = "Allow PostgreSQL from EB"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = ["sg-016b93b75c584bd70"]
  }

  ingress {
    description     = "Allow PostgreSQL from Fargate workers (logjam-worker-sg)"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.worker.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
