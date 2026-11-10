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
# ENIs from the VPC default SG ensures only worker compute is let into the
# brain's Postgres port (brain_network.tf names this group), rather than any
# resource launched into the VPC without an explicit SG.
# It is attached to the three Fargate worker ENIs at RunTask time
# (awsvpcConfiguration, driven by the ECS_SECURITY_GROUPS env). No ingress
# rules — workers only make outbound connections; egress-all lets them reach
# the brain, S3, Secrets Manager, ECR and Resend over the internet gateway
# (tasks run with assignPublicIp=ENABLED, see api/src/lib/ecsRunTask.ts).
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
