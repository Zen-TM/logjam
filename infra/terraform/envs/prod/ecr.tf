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

# ── Image retention ───────────────────────────────────────────────────────────
#
# Neither repo had ANY lifecycle policy until now, so every image built since
# March 2026 was still resident: 209 images / 71 GB, growing ~12 GB a month
# (~0.9 deploys/day across the two repos). At $0.10/GB-month that was $5/mo and
# rising by roughly $1.20/mo every month — the largest no-compromise line on the
# bill and the only one that compounds.
#
# Why a count and not an age: deploys are pinned by git SHA (deploy-api.yml
# tags <sha> and latest), and what must never be expired is the image the
# CURRENTLY DEPLOYED version references — EB re-pulls it on instance
# replacement, and the ECS task defs are sha-pinned too. That image is by
# definition the newest, so "keep the newest N" is safe in a way that "expire
# older than N days" is not: a quiet month with no deploys would age the live
# image out.
#
# 15 ≈ two weeks of rollback headroom at the current cadence. `latest` and the
# newest SHA are two tags on ONE image, so keeping the newest N never orphans
# latest.
#
# Rule ordering matters: ECR evaluates by ascending rulePriority and requires
# any `tagStatus: any` rule to sort last.
locals {
  ecr_retained_images = 15

  ecr_lifecycle_policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 7 days (failed/superseded builds)"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 15
        }
        action = { type = "expire" }
      },
    ]
  })
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_lifecycle_policy" "topo_worker" {
  repository = aws_ecr_repository.topo_worker.name
  policy     = local.ecr_lifecycle_policy
}
