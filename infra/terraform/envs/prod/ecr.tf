# Container image registries. CI (deploy-api.yml / deploy-topo-worker.yml)
# pushes images here; Terraform owns only the repo config, never image tags.
# (The cdk-* repo in this account is CDK bootstrap, unrelated to Logjam.)

resource "aws_ecr_repository" "api" {
  name                 = "logjam-api"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_repository" "topo_worker" {
  name                 = "logjam-topo-worker"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}
