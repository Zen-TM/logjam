# The brain's security group. Port 80 only from CloudFront's origin-facing
# prefix list (the API's origin-verify header covers what a prefix list shared
# with other customers cannot) and Postgres
# only from the Fargate workers. No SSH: the
# host is reached through Session Manager. Guard: tests/guards.tftest.hcl
# (brain_security_group_has_two_ingress_rules).
resource "aws_security_group" "brain" {
  name        = "logjam-brain-sg"
  description = "The brain: CloudFront to the API, workers to Postgres"
  vpc_id      = data.aws_vpc.main.id

  ingress {
    description     = "CloudFront origin-facing only"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = ["pl-b8a742d1"]
  }

  ingress {
    description     = "Postgres from the Fargate workers (logjam-worker-sg)"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.worker.id]
  }

  # A rule of its own, not a second group on the rule above: adding to that
  # rule would have AWS revoke it and authorize a new one, and a worker
  # connecting in between would be refused. The descriptions differ so the
  # two stay two rules when Terraform reads them back.
  ingress {
    description     = "Postgres from the Fargate workers (logjam-workers)"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.workers.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
