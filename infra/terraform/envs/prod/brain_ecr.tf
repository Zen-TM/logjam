# The brain's Postgres image (infra/brain/postgres), built for amd64 and arm64
# by .github/workflows/publish-brain-postgres.yml and pinned by tag in
# Terraform. IMMUTABLE: a tag the instance was started with never changes under
# it, so a restart cannot pick up a different Postgres. Guard:
# tests/guards.tftest.hcl (brain_postgres_image_is_immutable).
resource "aws_ecr_repository" "brain_postgres" {
  name                 = "logjam-brain-postgres"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

# A release is three images, as for logjam-api (ecr.tf): the manifest list the
# <sha> tag names and one image per architecture. Keep the newest 20 releases.
# The image the instance runs is the newest or close to it, and ECR refuses to
# expire an image a kept manifest list references.
locals {
  brain_postgres_retained_releases  = 20
  brain_postgres_images_per_release = 3
}

resource "aws_ecr_lifecycle_policy" "brain_postgres" {
  repository = aws_ecr_repository.brain_postgres.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 7 days (failed or superseded builds)"
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
          countNumber = local.brain_postgres_retained_releases * local.brain_postgres_images_per_release
        }
        action = { type = "expire" }
      },
    ]
  })
}

# The deploy role pushes the image and writes the release pointer. A separate
# policy so that the API's push grant (gha_ecr_push, iam.tf) stays as it is.
# `release.json` is the only object CI writes in the signals bucket: the brain
# runs whatever it names. Guard: tests/guards.tftest.hcl
# (brain_deploy_role_writes_only_release_json).
resource "aws_iam_role_policy" "gha_brain_deploy" {
  name = "logjam-brain-deploy"
  role = aws_iam_role.github_actions.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "PushBrainPostgresImage"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImages",
        ]
        Resource = aws_ecr_repository.brain_postgres.arn
      },
      {
        Sid      = "WriteReleasePointer"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.brain_signals.arn}/release.json"
      },
    ]
  })
}
