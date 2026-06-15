# ECS cluster. Originally created by the CloudFormation stack
# Infra-ECS-Cluster-logjam-cluster-7df4e928 (console wizard). We import it here
# and retire that stack (retaining the cluster) so Terraform is the sole owner.
resource "aws_ecs_cluster" "main" {
  name = "logjam-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  configuration {
    execute_command_configuration {
      logging = "DEFAULT"
    }
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
}
