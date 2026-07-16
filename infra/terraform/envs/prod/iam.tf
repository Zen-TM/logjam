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

# GitHub Actions OIDC deploy role (repo Zen-TM/logjam). The oidc-provider itself
# is left unmanaged — the trust policy embeds its ARN as a literal, so no
# provider resource is required for a clean plan.
resource "aws_iam_role" "github_actions" {
  name = "logjam-github-actions-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = "arn:aws:iam::620853681701:oidc-provider/token.actions.githubusercontent.com" }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike   = { "token.actions.githubusercontent.com:sub" = "repo:Zen-TM/logjam:*" }
      }
    }]
  })
}

# ── Customer-managed policies ──────────────────────────────────────────────────

resource "aws_iam_policy" "database_password_access" {
  name = "DatabasePasswordAccess"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:rds!db-6fa40c95-2bbc-4ee1-8f4e-de15c5abe3c4-4f8qWr"
    }]
  })
}

# Lets the ECS execution role inject RESEND_API_KEY into the worker task defs at
# launch (the three workers send transactional email via Resend; secret value
# lives in Secrets Manager, never in Terraform/git).
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

resource "aws_iam_role_policy_attachment" "ecs_exec_db_password" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = aws_iam_policy.database_password_access.arn
}

resource "aws_iam_role_policy_attachment" "ecs_exec_resend_api_key" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = aws_iam_policy.resend_api_key_access.arn
}

resource "aws_iam_role_policy_attachment" "topo_worker_aws_managed" {
  role       = aws_iam_role.topo_worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "topo_worker_custom" {
  role       = aws_iam_role.topo_worker.name
  policy_arn = aws_iam_policy.topo_worker.arn
}

resource "aws_iam_role_policy_attachment" "gha_ecr" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess"
}

# NOTE: the broad AmazonS3FullAccess attachment was REMOVED (least-privilege).
# The two S3 surfaces CI actually touches are scoped explicitly instead:
#   - frontend SPA bucket   -> aws_iam_role_policy.gha_frontend_deploy (below)
#   - EB app-version bucket -> aws_iam_role_policy.gha_eb_appversions (below); the
#     beanstalk-deploy action uploads the deploy.zip there. (gha_eb's
#     AdministratorAccess-AWSElasticBeanstalk also covers elasticbeanstalk-*
#     buckets; this explicit grant removes the dependency on that breadth.)
# VERIFY BEFORE APPLY: scan CloudTrail for any github-actions-role S3 call
# outside these two buckets; if found, widen the scoped grant, never re-add
# the managed full-access policy.

resource "aws_iam_role_policy_attachment" "gha_eb" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess-AWSElasticBeanstalk"
}

# Plan-on-PR (terraform-plan.yml): terraform plan against envs/prod needs
# broad Describe/Get/List across every managed service plus GetObject on the
# state bucket. Hand-listing those actions is brittle (every new resource type
# breaks the plan with AccessDenied), so use the AWS-managed ReadOnlyAccess and
# carve the sensitive surfaces back out with an explicit Deny below. Write
# perms for TF apply stay off this role until Phase 3 (see
# .claude/cicd-staging-plan.md guardrails).
resource "aws_iam_role_policy_attachment" "gha_readonly" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# ── Inline policy ──────────────────────────────────────────────────────────────

resource "aws_iam_role_policy" "gha_frontend_deploy" {
  name = "logjam-frontend-deploy"
  role = aws_iam_role.github_actions.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::logjam-frontend-620853681701-ap-southeast-2-an",
          "arn:aws:s3:::logjam-frontend-620853681701-ap-southeast-2-an/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = "cloudfront:CreateInvalidation"
        Resource = "arn:aws:cloudfront::620853681701:distribution/E22J79PHZM2K"
      },
    ]
  })
}

# Privacy carve-out from ReadOnlyAccess (which grants s3:GetObject on every
# bucket): CI must never be able to read user canyon data (media photos,
# LiDAR/tile outputs) or pull secret values. Explicit Deny beats the managed
# Allow. Bucket-level GetBucket* config reads stay allowed — terraform
# refresh of the storage module needs those; it never reads objects. The
# state bucket (logjam-tfstate-*) is intentionally NOT denied: init needs
# GetObject on the state file. Plans run -lock=false, so no write is needed.
resource "aws_iam_role_policy" "gha_readonly_privacy_deny" {
  name = "logjam-ci-readonly-privacy-deny"
  role = aws_iam_role.github_actions.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DenyUserDataObjects"
        Effect = "Deny"
        Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::logjam-media",
          "arn:aws:s3:::logjam-media/*",
          "arn:aws:s3:::logjam-topo-jobs",
          "arn:aws:s3:::logjam-topo-jobs/*",
          # WORM audit sink: pgaudit query text can embed canyon names/coords.
          "arn:aws:s3:::logjam-audit-620853681701",
          "arn:aws:s3:::logjam-audit-620853681701/*",
        ]
      },
      # origin_verify is carved out: terraform refresh of its
      # aws_secretsmanager_secret_version reads the value, and that value
      # already lives in the TF state the CI role must read — denying the
      # API call protects nothing and breaks the plan.
      {
        Sid         = "DenySecretValues"
        Effect      = "Deny"
        Action      = "secretsmanager:GetSecretValue"
        NotResource = aws_secretsmanager_secret.origin_verify.arn
      },
      # ...and explicitly allowed: ReadOnlyAccess doesn't include
      # GetSecretValue, so the carve-out alone still fails with "no
      # identity-based policy allows".
      {
        Sid      = "AllowOriginVerifyRead"
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = aws_secretsmanager_secret.origin_verify.arn
      },
      # Scoped to the Cognito email CMK (the only customer-managed key):
      # a blanket kms:Decrypt deny would also hit the AWS-managed
      # aws/secretsmanager key used by the origin_verify read above.
      {
        Sid      = "DenyCmkDecrypt"
        Effect   = "Deny"
        Action   = "kms:Decrypt"
        Resource = aws_kms_key.cognito_email.arn
      },
      # Postgres log export carries pgaudit query text (same sensitivity as
      # the audit bucket). Deny reading log *events*; DescribeLogGroups stays
      # allowed so terraform can refresh log-group resources.
      {
        Sid    = "DenyDbLogEvents"
        Effect = "Deny"
        Action = ["logs:GetLogEvents", "logs:FilterLogEvents", "logs:StartQuery", "logs:GetQueryResults"]
        Resource = [
          "arn:aws:logs:ap-southeast-2:620853681701:log-group:/aws/rds/*",
          "arn:aws:logs:ap-southeast-2:620853681701:log-group:/aws/rds/*:*",
        ]
      },
    ]
  })
}

# EB app-version uploads (beanstalk-deploy pushes deploy.zip here). Explicit
# replacement for the removed AmazonS3FullAccess. If the live bucket name
# differs, fix it here — do NOT re-add the managed full-access policy.
resource "aws_iam_role_policy" "gha_eb_appversions" {
  name = "logjam-eb-appversions-deploy"
  role = aws_iam_role.github_actions.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["s3:PutObject", "s3:GetObject", "s3:ListBucket"]
      Resource = [
        "arn:aws:s3:::elasticbeanstalk-ap-southeast-2-620853681701",
        "arn:aws:s3:::elasticbeanstalk-ap-southeast-2-620853681701/*",
      ]
    }]
  })
}
