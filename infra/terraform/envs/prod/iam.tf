# ── Roles ─────────────────────────────────────────────────────────────────────

# ECS task EXECUTION role (pulls images, writes logs, injects secrets). Note the
# 2008-10-17 trust-policy version — that is what the live role carries; keep it
# exact or the plan shows a diff.
resource "aws_iam_role" "ecs_task_execution" {
  name = "ecsTaskExecutionRole"
  assume_role_policy = jsonencode({
    Version = "2008-10-17"
    Statement = [{
      Sid       = ""
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# ECS task ROLE assumed by the running worker containers (S3 / SES / SQS-legacy).
resource "aws_iam_role" "topo_worker" {
  name        = "logjam-topo-worker-role"
  description = "Allows ECS tasks to call AWS services on your behalf."
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = ""
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Task role for the monthly place registry build (ecs.tf): it may list, read
# and replace what is under master/places/ in the topo bucket, and nothing else.
resource "aws_iam_role" "place_registry" {
  name = "logjam-place-registry-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "place_registry" {
  name = "logjam-place-registry-publish"
  role = aws_iam_role.place_registry.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PublishPlaceRegistry"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "arn:aws:s3:::logjam-topo-jobs/master/places/*"
      },
      {
        # upload() in topo/build_place_registry.py lists with
        # Prefix=master/places/v1/latest.json to learn whether a build is
        # already published, before it reads one; the condition keeps the
        # list to that prefix.
        Sid       = "ListPlaceRegistry"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = "arn:aws:s3:::logjam-topo-jobs"
        Condition = { StringLike = { "s3:prefix" = "master/places/*" } }
      },
    ]
  })
}

# What EventBridge Scheduler assumes to launch the monthly build: RunTask on
# that one family, in the one cluster, passing only its two roles.
resource "aws_iam_role" "place_registry_scheduler" {
  name = "logjam-place-registry-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = "620853681701" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "place_registry_scheduler" {
  name = "logjam-place-registry-runtask"
  role = aws_iam_role.place_registry_scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RunPlaceRegistryTask"
        Effect = "Allow"
        Action = "ecs:RunTask"
        # The schedule names the family without a revision; RunTask resolves
        # it, so both forms are listed.
        Resource = [
          aws_ecs_task_definition.place_registry.arn_without_revision,
          "${aws_ecs_task_definition.place_registry.arn_without_revision}:*",
        ]
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn }
        }
      },
      {
        Sid    = "PassPlaceRegistryRoles"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          aws_iam_role.ecs_task_execution.arn,
          aws_iam_role.place_registry.arn,
        ]
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
    ]
  })
}

# Task role for the gauges job (ecs.tf): it may list, read and replace what is
# under master/gauges/ in the topo bucket, and nothing else.
resource "aws_iam_role" "gauges" {
  name = "logjam-gauges-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "gauges" {
  name = "logjam-gauges-publish"
  role = aws_iam_role.gauges.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PublishGauges"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "arn:aws:s3:::logjam-topo-jobs/master/gauges/*"
      },
      {
        # read_json() and history_ids() in topo/build_gauges.py list before
        # they read, as upload() does for the place registry.
        Sid       = "ListGauges"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = "arn:aws:s3:::logjam-topo-jobs"
        Condition = { StringLike = { "s3:prefix" = "master/gauges/*" } }
      },
    ]
  })
}

# What EventBridge Scheduler assumes to launch the job: RunTask on that one
# family, in the one cluster, passing only its two roles.
resource "aws_iam_role" "gauges_scheduler" {
  name = "logjam-gauges-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = "620853681701" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "gauges_scheduler" {
  name = "logjam-gauges-runtask"
  role = aws_iam_role.gauges_scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RunGaugesTask"
        Effect = "Allow"
        Action = "ecs:RunTask"
        Resource = [
          aws_ecs_task_definition.gauges.arn_without_revision,
          "${aws_ecs_task_definition.gauges.arn_without_revision}:*",
        ]
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn }
        }
      },
      {
        Sid    = "PassGaugesRoles"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          aws_iam_role.ecs_task_execution.arn,
          aws_iam_role.gauges.arn,
        ]
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
    ]
  })
}

# Task role for the monthly fire history build (ecs.tf): it may list, read
# and replace what is under fire/ in the topo bucket, and nothing else.
resource "aws_iam_role" "fire_history" {
  name = "logjam-fire-history-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "fire_history" {
  name = "logjam-fire-history-publish"
  role = aws_iam_role.fire_history.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PublishFireHistory"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "arn:aws:s3:::logjam-topo-jobs/fire/*"
      },
      {
        # The Fire history overlay's archive, which the CDN serves under
        # /master/. Write only: publish() never reads it back.
        Sid      = "PublishFireOverlay"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "arn:aws:s3:::logjam-topo-jobs/master/fire/*"
      },
      {
        # read_legend() in topo/build_fire_history.py lists before it reads,
        # as upload() does for the place registry.
        Sid       = "ListFireHistory"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = "arn:aws:s3:::logjam-topo-jobs"
        Condition = { StringLike = { "s3:prefix" = "fire/*" } }
      },
    ]
  })
}

# What EventBridge Scheduler assumes to launch the build: RunTask on that one
# family, in the one cluster, passing only its two roles.
resource "aws_iam_role" "fire_history_scheduler" {
  name = "logjam-fire-history-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = "620853681701" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "fire_history_scheduler" {
  name = "logjam-fire-history-runtask"
  role = aws_iam_role.fire_history_scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RunFireHistoryTask"
        Effect = "Allow"
        Action = "ecs:RunTask"
        Resource = [
          aws_ecs_task_definition.fire_history.arn_without_revision,
          "${aws_ecs_task_definition.fire_history.arn_without_revision}:*",
        ]
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn }
        }
      },
      {
        Sid    = "PassFireHistoryRoles"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          aws_iam_role.ecs_task_execution.arn,
          aws_iam_role.fire_history.arn,
        ]
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
    ]
  })
}

# Task role for the monthly coverage build (ecs.tf): it may list, read and
# replace what is under master/coverage/ in the topo bucket, and nothing else.
resource "aws_iam_role" "coverage" {
  name = "logjam-coverage-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "coverage" {
  name = "logjam-coverage-publish"
  role = aws_iam_role.coverage.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PublishCoverage"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "arn:aws:s3:::logjam-topo-jobs/master/coverage/*"
      },
      {
        # read_state() in topo/build_coverage.py lists before it reads, as
        # upload() does for the place registry.
        Sid       = "ListCoverage"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = "arn:aws:s3:::logjam-topo-jobs"
        Condition = { StringLike = { "s3:prefix" = "master/coverage/*" } }
      },
    ]
  })
}

# What EventBridge Scheduler assumes to launch the build: RunTask on that one
# family, in the one cluster, passing only its two roles.
resource "aws_iam_role" "coverage_scheduler" {
  name = "logjam-coverage-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = "620853681701" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "coverage_scheduler" {
  name = "logjam-coverage-runtask"
  role = aws_iam_role.coverage_scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RunCoverageTask"
        Effect = "Allow"
        Action = "ecs:RunTask"
        Resource = [
          aws_ecs_task_definition.coverage.arn_without_revision,
          "${aws_ecs_task_definition.coverage.arn_without_revision}:*",
        ]
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn }
        }
      },
      {
        Sid    = "PassCoverageRoles"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          aws_iam_role.ecs_task_execution.arn,
          aws_iam_role.coverage.arn,
        ]
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
    ]
  })
}

# GitHub Actions OIDC roles (repo Zen-TM/logjam). The oidc-provider's ARN is
# embedded as a literal, as before.
#
# Three roles, split by what may assume them. The OIDC `sub` claim names where a
# workflow run came from; scoping it by environment and ref prevents arbitrary
# branches from deploying to prod or running the migrate task without a PR.
#   - deploy (this role, name kept so nothing else moves): only jobs running in
#     the `prod` GitHub Environment, which only `main` may deploy to.
#   - plan (below): read-only, for terraform plan on PRs (the terraform-plan
#     Environment) and on main.
#   - apply (iam_apply.tf): terraform apply on merge, `prod` Environment only.
locals {
  github_oidc_provider_arn = "arn:aws:iam::620853681701:oidc-provider/token.actions.githubusercontent.com"
}

resource "aws_iam_role" "github_actions" {
  name = "logjam-github-actions-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:Zen-TM/logjam:environment:prod"
        }
      }
    }]
  })
}

resource "aws_iam_role" "github_actions_plan" {
  name        = "logjam-github-actions-plan-role"
  description = "Read-only terraform plan from GitHub Actions (PRs and main)."
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          # PR plans run in the terraform-plan Environment, which any
          # collaborator's PR enters unapproved, so this role must read no
          # more than a collaborator can
          # (docs/decisions/0035-pr-plans-run-unattended-and-a-main-only-job-signs-them.md);
          # main is the nightly drift plan. Guard: tests/guards.tftest.hcl.
          "token.actions.githubusercontent.com:sub" = [
            "repo:Zen-TM/logjam:environment:terraform-plan",
            "repo:Zen-TM/logjam:ref:refs/heads/main",
          ]
        }
      }
    }]
  })
}

# ── Customer-managed policies ──────────────────────────────────────────────────

# Lets the ECS execution role inject the Resend API key as SMTP_PASSWORD into the
# worker task defs at launch, and the brain's role read it (Resend's SMTP relay
# takes the key as its password; secret value lives in Secrets Manager, never in
# Terraform/git).
resource "aws_iam_policy" "resend_api_key_access" {
  name = "ResendApiKeyAccess"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/resend-api-key-59egrs*"
    }]
  })
}

# Lets the ECS execution role inject WATERNSW_API_KEY into the gauges task at
# launch. The value lives in Secrets Manager, set by hand.
resource "aws_iam_policy" "waternsw_api_key_access" {
  name = "WaternswApiKeyAccess"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = aws_secretsmanager_secret.waternsw_api_key.arn
    }]
  })
}

resource "aws_iam_policy" "topo_worker" {
  name = "logjam-topo-worker-policy"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "S3Topo"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::logjam-topo-jobs/*"
      },
      {
        Sid      = "S3TopoList"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = "arn:aws:s3:::logjam-topo-jobs"
      },
    ]
  })
}

# ── Managed-policy attachments ─────────────────────────────────────────────────

resource "aws_iam_role_policy_attachment" "ecs_exec_aws_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "ecs_exec_resend_api_key" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = aws_iam_policy.resend_api_key_access.arn
}

resource "aws_iam_role_policy_attachment" "ecs_exec_waternsw_api_key" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = aws_iam_policy.waternsw_api_key_access.arn
}

resource "aws_iam_role_policy_attachment" "topo_worker_aws_managed" {
  role       = aws_iam_role.topo_worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "topo_worker_custom" {
  role       = aws_iam_role.topo_worker.name
  policy_arn = aws_iam_policy.topo_worker.arn
}

# Scoped ECR push permissions (least-privilege): deploy-api.yml and
# deploy-topo-worker.yml only ever docker-login then push to these two repos.
# Scoped to AWS's own documented push action set (ecr:GetAuthorizationToken has
# no resource-level permissions, hence Resource "*" for that statement only)
# on just logjam-api / logjam-topo-worker.
# VERIFY BEFORE APPLY: scan CloudTrail for any github-actions-role ecr:*
# call outside these two repos or this action set; if found, widen this
# grant, never re-add the managed full-access policy.
resource "aws_iam_role_policy" "gha_ecr_push" {
  name = "logjam-ecr-push"
  role = aws_iam_role.github_actions.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrAuth"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "EcrPushPull"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          # rollback.yml checks the image it repins to still exists (ECR
          # keeps 15 releases). Also in ReadOnlyAccess; named so this policy stands on
          # its own when that attachment narrows.
          "ecr:DescribeImages",
        ]
        Resource = [
          aws_ecr_repository.api.arn,
          aws_ecr_repository.topo_worker.arn,
        ]
      },
    ]
  })
}

# NOTE: the broad AmazonS3FullAccess attachment was REMOVED (least-privilege).
# The one S3 surface CI touches is scoped explicitly instead: the frontend SPA
# bucket (aws_iam_role_policy.gha_frontend_deploy, below), plus the brain's
# release pointer (brain_ecr.tf).
# VERIFY BEFORE APPLY: scan CloudTrail for any github-actions-role S3 call
# outside these buckets; if found, widen the scoped grant, never re-add the
# managed full-access policy.

# Plan-on-PR (terraform-plan.yml): terraform plan against envs/prod needs
# broad Describe/Get/List across every managed service plus GetObject on the
# state bucket. Hand-listing those actions is brittle (every new resource type
# breaks the plan with AccessDenied), so use the AWS-managed ReadOnlyAccess and
# carve the sensitive surfaces back out with an explicit Deny below. Write
# perms for terraform apply live only on the apply role (iam_apply.tf).
resource "aws_iam_role_policy_attachment" "gha_readonly" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# The plan role gets the same read-only grant and the same privacy carve-out
# (one document, local.ci_readonly_privacy_deny, attached to both roles). The
# deploy role keeps its copy until its permissions are narrowed separately.
resource "aws_iam_role_policy_attachment" "gha_plan_readonly" {
  role       = aws_iam_role.github_actions_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role_policy" "gha_plan_readonly_privacy_deny" {
  name   = "logjam-ci-readonly-privacy-deny"
  role   = aws_iam_role.github_actions_plan.id
  policy = local.ci_readonly_privacy_deny
}

# ── Inline policy ──────────────────────────────────────────────────────────────

# GetObject and GetInvalidation are also in ReadOnlyAccess; named here so this
# policy stands on its own when that attachment narrows. The deploy guard
# reads index.html's release-sha (HeadObject), rollback.yml copies
# releases/<sha>/index.html over index.html (CopyObject reads its source) and
# reads the release's file list, and both wait for their invalidation.
resource "aws_iam_role_policy" "gha_frontend_deploy" {
  name = "logjam-frontend-deploy"
  role = aws_iam_role.github_actions.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::logjam-frontend-620853681701-ap-southeast-2-an",
          "arn:aws:s3:::logjam-frontend-620853681701-ap-southeast-2-an/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
        Resource = "arn:aws:cloudfront::620853681701:distribution/E22J79PHZM2K"
      },
    ]
  })
}

# Privacy carve-out from ReadOnlyAccess (which grants s3:GetObject on every
# bucket and log events in every log group): CI must never be able to read
# user canyon data (media photos, LiDAR/tile outputs), logs, or secret values.
# Guard: tests/guards.tftest.hcl.
# Explicit Deny beats the managed Allow. Objects in this account's buckets and
# log events are denied by default, so a bucket or log group added later is
# closed without an edit here; the buckets CI does read are the named
# exceptions. Bucket-level GetBucket* config reads stay allowed — terraform
# refresh of the storage module needs those; it never reads objects.
#
# s3:ListBucket is deliberately NOT denied: HeadBucket (terraform's bucket
# existence check) requires it, and denying it made CI plans propose
# recreating all three buckets + their attached configs. Exposure is key
# enumeration only — keys are opaque UUIDs/job ids, never canyon names —
# while object content stays denied.
resource "aws_iam_role_policy" "gha_readonly_privacy_deny" {
  name   = "logjam-ci-readonly-privacy-deny"
  role   = aws_iam_role.github_actions.id
  policy = local.ci_readonly_privacy_deny
}

locals {
  ci_readonly_privacy_deny = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Every bucket of ours but the two CI reads objects from: media, topo
      # outputs, the WORM audit sink (pgaudit query text can embed canyon
      # names/coords), the access logs (viewers' IPs and request paths) and
      # any bucket added later. The exceptions: init reads the state file
      # (plans run -lock=false, so no write is needed), and the frontend deploy
      # and rollback read release files.
      #
      # Only buckets in this account: AWS-owned buckets that a service reads
      # with the caller's credentials stay readable. User data lives only in
      # this account.
      {
        Sid    = "DenyObjectsByDefault"
        Effect = "Deny"
        Action = ["s3:GetObject", "s3:GetObjectVersion"]
        NotResource = [
          "arn:aws:s3:::logjam-tfstate-620853681701/*",
          "arn:aws:s3:::logjam-frontend-620853681701-ap-southeast-2-an/*",
        ]
        Condition = { StringEquals = { "aws:ResourceAccount" = "620853681701" } }
      },
      # No exception: the origin-verify secret version is write-only
      # (origin_verify.tf), so no plan or apply reads a secret value.
      {
        Sid      = "DenySecretValues"
        Effect   = "Deny"
        Action   = ["secretsmanager:GetSecretValue", "secretsmanager:BatchGetSecretValue"]
        Resource = "*"
      },
      # Scoped to the Cognito email CMK (the only customer-managed key): a
      # blanket kms:Decrypt deny would also hit AWS-managed keys that
      # terraform refresh reads through.
      {
        Sid      = "DenyCmkDecrypt"
        Effect   = "Deny"
        Action   = "kms:Decrypt"
        Resource = aws_kms_key.cognito_email.arn
      },
      # Users' emails and attributes. Terraform reads the pool and its client
      # (DescribeUserPool*), never its users.
      {
        Sid      = "DenyUserDirectory"
        Effect   = "Deny"
        Action   = ["cognito-idp:ListUsers", "cognito-idp:ListUsersInGroup", "cognito-idp:AdminGet*", "cognito-idp:AdminList*"]
        Resource = "*"
      },
      # Every log group: the Postgres log carries pgaudit query text (same
      # sensitivity as the audit bucket), and the API's request log, which the
      # brain streams to CloudWatch, carries viewers' IPs and request paths. Deny
      # reading log *events*; DescribeLogGroups stays allowed so terraform can
      # refresh log-group resources. Nothing in CI reads an event.
      {
        Sid      = "DenyLogEvents"
        Effect   = "Deny"
        Action   = ["logs:GetLogEvents", "logs:FilterLogEvents", "logs:StartQuery", "logs:GetQueryResults", "logs:StartLiveTail"]
        Resource = "*"
      },
      # The same logs by another route: a single record by pointer (no
      # resource-level permission, hence "*"). Nothing in CI reads one.
      # ReadOnlyAccess allows a new service's own log reads (a managed
      # database's log files, say), so a service added later stays open
      # until its read actions are listed here.
      {
        Sid      = "DenyLogsByOtherRoutes"
        Effect   = "Deny"
        Action   = ["logs:GetLogRecord"]
        Resource = "*"
      },
      # Message bodies and parameter values: ReadOnlyAccess allows both, and
      # receiving a message also hides it from its real consumer.
      {
        Sid      = "DenyMessagesAndParameters"
        Effect   = "Deny"
        Action   = ["sqs:ReceiveMessage", "ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:GetParameterHistory"]
        Resource = "*"
      },
      # A disk snapshot read block by block through EBS's direct APIs: the
      # brain's disk holds the database. ReadOnlyAccess does not allow these
      # today; denied so that never depends on AWS's list.
      {
        Sid      = "DenySnapshotBlocks"
        Effect   = "Deny"
        Action   = ["ebs:GetSnapshotBlock", "ebs:ListSnapshotBlocks", "ebs:ListChangedBlocks"]
        Resource = "*"
      },
      # A shell on an instance (Session Manager, Run Command) or inside a
      # running task (ECS Exec): root on the brain's host, a route to the
      # database that needs no output read, since a command can copy data
      # anywhere. Only the maintainer's own identity operates the brain;
      # Terraform never calls these. Ending a session (ssm:TerminateSession)
      # stays allowed.
      {
        Sid      = "DenyShells"
        Effect   = "Deny"
        Action   = ["ssm:SendCommand", "ssm:StartSession", "ssm:ResumeSession", "ecs:ExecuteCommand"]
        Resource = "*"
      },
      # A Run Command's text and output, which SSM keeps for 30 days: the
      # maintainer operates the brain with it, and ReadOnlyAccess allows
      # ssm:Get* and ssm:List*. Nothing in CI reads one.
      {
        Sid      = "DenyCommandOutput"
        Effect   = "Deny"
        Action   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations", "ssm:ListCommands"]
        Resource = "*"
      },
    ]
  })
}

# Let the deploy workflow launch the pre-deploy migrate one-shot
# (aws_ecs_task_definition.api_migrate) and poll its result before the new
# release is written to the brain. Scoped to that task def + the one cluster; PassRole limited
# to the exact execution role the task uses (no task role is passed), gated to
# ECS tasks so the deploy identity can't repurpose it elsewhere.
# Also let the deploy workflows register a task-definition revision pinned to
# the image sha they just pushed (infra/scripts/pin-ecs-task-image.sh), so a
# RunTask launches a known commit instead of resolving the moving `:latest` tag.
#
# RegisterTaskDefinition supports no resource-level permission — there is no
# task-def ARN to scope to before the revision exists — so it is `*`. What that
# does NOT grant is the ability to run anything: ecs:RunTask stays scoped to
# logjam-api-migrate in the policy above, and the API's own runtime role is what
# launches the workers. The teeth are in PassRole, which is limited to the
# roles these task defs already use and gated to ECS tasks, so a registered
# definition cannot attach a role none of them has. A place registry revision
# given the broader topo worker role would still not launch: the scheduler may
# pass only the place registry's own (place_registry_scheduler above).
resource "aws_iam_role_policy" "gha_pin_task_defs" {
  name = "logjam-gha-pin-task-defs"
  role = aws_iam_role.github_actions.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadAndRegisterTaskDefinitions"
        Effect = "Allow"
        # DescribeTaskDefinition is also in the attached ReadOnlyAccess; named
        # here too so this policy stands on its own if that attachment ever
        # narrows.
        Action   = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"]
        Resource = "*"
      },
      {
        Sid    = "PassWorkerRoles"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          aws_iam_role.ecs_task_execution.arn,
          aws_iam_role.topo_worker.arn,
          aws_iam_role.place_registry.arn,
          aws_iam_role.gauges.arn,
          aws_iam_role.fire_history.arn,
          aws_iam_role.coverage.arn,
        ]
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
    ]
  })
}

resource "aws_iam_role_policy" "gha_migrate_runtask" {
  name = "logjam-gha-migrate-runtask"
  role = aws_iam_role.github_actions.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RunMigrateTask"
        Effect   = "Allow"
        Action   = "ecs:RunTask"
        Resource = "arn:aws:ecs:ap-southeast-2:620853681701:task-definition/logjam-api-migrate:*"
        Condition = {
          ArnEquals = { "ecs:cluster" = "arn:aws:ecs:ap-southeast-2:620853681701:cluster/logjam-cluster" }
        }
      },
      {
        Sid      = "ObserveMigrateTask"
        Effect   = "Allow"
        Action   = "ecs:DescribeTasks"
        Resource = "arn:aws:ecs:ap-southeast-2:620853681701:task/logjam-cluster/*"
      },
      {
        Sid      = "PassMigrateExecRole"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = "arn:aws:iam::620853681701:role/ecsTaskExecutionRole"
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
    ]
  })
}
