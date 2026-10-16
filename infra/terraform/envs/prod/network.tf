# Networking. The VPC and its subnets pre-exist and are shared infrastructure —
# referenced as data, not managed (Terraform only needs their IDs to feed the
# worker env). sg-0543d2bbce86b5d2a is this VPC's DEFAULT security group,
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

# Dedicated Fargate worker security group (logjam-worker-sg). Isolating worker
# ENIs from the VPC default SG ensures only worker compute has access to RDS,
# rather than any resource launched into the VPC without an explicit SG.
# It is attached to the three Fargate worker ENIs at RunTask time
# (awsvpcConfiguration, driven by the ECS_SECURITY_GROUPS env), and the RDS
# ingress references it instead of the default. No ingress rules — workers only
# make outbound connections; egress-all lets them reach RDS, S3, Secrets
# Manager, ECR and Resend over the internet gateway (tasks run with
# assignPublicIp=ENABLED, see api/src/lib/ecsRunTask.ts).
resource "aws_security_group" "worker" {
  name        = "logjam-worker-sg"
  description = "Fargate worker ENIs (topo/export/geo-pdf) - RDS ingress source"
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
# Fargate worker SG (aws_security_group.worker). Both referenced by id.
# Least-privilege: only the API and worker compute, not the whole VPC CIDR
# and not the account-default SG. This is the SG attached to
# aws_db_instance.main.
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
