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

# The old worker group, being retired: nothing launches into it any more. It
# stays, with its rule on the brain's Postgres port (brain_network.tf), until
# the tasks that were already running in it have ended.
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

# The Fargate worker group. It takes over from logjam-worker-sg, whose
# description names a database that is gone: AWS lets neither a group's
# description nor its name be edited, and two groups in a VPC cannot share a
# name, so the group is replaced under a new one. The brain admits both on
# 5432 (brain_network.tf) while the old one empties.
# It is attached to the worker ENIs at RunTask time (awsvpcConfiguration,
# driven by the ECS_SECURITY_GROUPS env), to the scheduled tasks and to the
# deploy's migration task. No ingress rules: workers only make outbound
# connections, and egress-all lets them reach the brain, S3, Secrets Manager,
# ECR and Resend over the internet gateway (tasks run with
# assignPublicIp=ENABLED, see api/src/lib/ecsRunTask.ts).
resource "aws_security_group" "workers" {
  name        = "logjam-workers"
  description = "Fargate tasks (workers, migration, scheduled jobs) - the group the brain admits on 5432"
  vpc_id      = data.aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
