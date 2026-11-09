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
# Bounds storage growth and cost from accumulating unneeded container image
# layers across deploy runs.
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
# A release of logjam-api is three images, not one: the manifest list that
# `:<sha>` and `:latest` name and one image per architecture (deploy-api.yml),
# and the count rule counts all of them. ECR refuses to expire an image a
# manifest list still references ("If an image is referenced by a manifest list,
# it cannot be expired or archived without the manifest list being deleted or
# archived first", Amazon ECR User Guide, "Lifecycle policy evaluation rules"),
# so no rule here can strip an architecture from a release that is kept; it
# only has to count them, or 15 would keep five releases. The topo worker image
# is one architecture, one image per release.
#
# Rule ordering matters: ECR evaluates by ascending rulePriority and requires
# any `tagStatus: any` rule to sort last.
locals {
  ecr_retained_releases = 15
  ecr_images_per_release = {
    api         = 3
    topo_worker = 1
  }

  ecr_lifecycle_policy = {
    for repo, images in local.ecr_images_per_release : repo => jsonencode({
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
            countNumber = local.ecr_retained_releases * images
          }
          action = { type = "expire" }
        },
      ]
    })
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy     = local.ecr_lifecycle_policy["api"]
}

resource "aws_ecr_lifecycle_policy" "topo_worker" {
  repository = aws_ecr_repository.topo_worker.name
  policy     = local.ecr_lifecycle_policy["topo_worker"]
}
