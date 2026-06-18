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

resource "aws_iam_role_policy_attachment" "gha_s3" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
}

resource "aws_iam_role_policy_attachment" "gha_eb" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess-AWSElasticBeanstalk"
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
