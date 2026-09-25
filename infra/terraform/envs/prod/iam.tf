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

# INF-006: AmazonEC2ContainerRegistryFullAccess REMOVED (least-privilege) —
# deploy-api.yml and deploy-topo-worker.yml only ever docker-login then push
# to these two repos. Scoped to AWS's own documented push action set
# (ecr:GetAuthorizationToken has no resource-level permissions, hence
# Resource "*" for that statement only) on just logjam-api / logjam-topo-worker.
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
# The two S3 surfaces CI actually touches are scoped explicitly instead:
#   - frontend SPA bucket   -> aws_iam_role_policy.gha_frontend_deploy (below)
#   - EB app-version bucket -> aws_iam_role_policy.gha_eb_appversions (below); the
#     beanstalk-deploy action uploads the deploy.zip there. NOTE this grant is
#     not the only thing authorising that upload: the EB managed policy covers
#     elasticbeanstalk-* buckets as a side effect and is still attached (the
#     narrowing was tried and reverted — see gha_eb below). It is kept explicit
#     so the dependency on that breadth is stated rather than assumed.
# VERIFY BEFORE APPLY: scan CloudTrail for any github-actions-role S3 call
# outside these two buckets; if found, widen the scoped grant, never re-add
# the managed full-access policy.

# INF-006 (EB half): ATTEMPTED, REVERTED 2026-08-29 — the managed policy stays.
#
# The narrowing was applied and the very next deploy failed at UpdateEnvironment.
# beanstalk-deploy's own six API calls were right; what they miss is everything
# ELASTIC BEANSTALK ITSELF does under the caller's identity while updating an
# environment. Observed, from that failure plus CloudTrail of the preceding
# successful deploy:
#   s3:PutObjectAcl, s3:DeleteObject  on the elasticbeanstalk-* bucket, under
#                                     resources/environments/.../_runtime/...
#   sns:CreateTopic, sns:Unsubscribe  on ElasticBeanstalkNotifications-Environment-*
#   autoscaling:SuspendProcesses / ResumeProcesses
#   cloudformation:Describe*, ListStackResources, ec2:DescribeLaunchTemplate*
# ...and that is only what THIS update happened to need; a create, rebuild or
# scale path would surface more.
#
# EB was never at risk — it stayed Green on the previous version throughout —
# but the deploy pipeline was blocked, and every further guess costs another
# failed prod deploy. An over-broad grant that is documented beats a broken
# deploy role.
#
# TO RETRY PROPERLY: enumerate a full successful deploy from CloudTrail under
# this role, build the policy from that observed set, and verify it against a
# throwaway EB environment rather than prod. Do NOT re-derive it from the
# action's source alone — that is exactly what failed here.
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
#
# s3:ListBucket is deliberately NOT denied: HeadBucket (terraform's bucket
# existence check) requires it, and denying it made CI plans propose
# recreating all three buckets + their attached configs. Exposure is key
# enumeration only — keys are opaque UUIDs/job ids, never canyon names —
# while object content stays denied.
resource "aws_iam_role_policy" "gha_readonly_privacy_deny" {
  name = "logjam-ci-readonly-privacy-deny"
  role = aws_iam_role.github_actions.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DenyUserDataObjects"
        Effect = "Deny"
        Action = ["s3:GetObject", "s3:GetObjectVersion"]
        Resource = [
          "arn:aws:s3:::logjam-media/*",
          "arn:aws:s3:::logjam-topo-jobs/*",
          # WORM audit sink: pgaudit query text can embed canyon names/coords.
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

# ── EB instance role (logjam-eb-role) least-privilege replacements (CP-001) ────
# The EB API instance role is EB-managed (created with the environment), so —
# like the other eb-role grants (db_app_role.tf, origin_verify.tf) — it is
# referenced by literal name, not managed as a resource. Live, it carries three
# over-broad AWS-managed policies. A compromised API (single public origin)
# would otherwise inherit s3:* account-wide (incl. the WORM audit bucket +
# tfstate). This block adds SCOPED replacements mirroring the CI-role treatment
# above (gha_eb_appversions / gha_frontend_deploy):
#   AmazonS3FullAccess     -> aws_iam_role_policy.eb_instance_s3_scoped (below)
#   AmazonCognitoPowerUser -> aws_iam_role_policy.eb_cognito_admin_getuser (below)
#   AmazonSESFullAccess    -> DEAD grant (SES replaced by Resend); no replacement.
# Terraform cannot detach a policy attached OUTSIDE its state, so the three
# `aws iam detach-role-policy` calls are operator-gated (see the cloud-posture
# fix report). Apply THIS block BEFORE the operator detaches the broad managed
# policies so the instance never loses the S3/Cognito access it legitimately
# needs (presigned media/topo URLs; Cognito AdminGetUser).
# VERIFY BEFORE DETACH: scan CloudTrail for any logjam-eb-role S3 call outside
# logjam-media / logjam-topo-jobs; if found, widen this scoped grant, never
# re-add AmazonS3FullAccess.
resource "aws_iam_role_policy" "eb_instance_s3_scoped" {
  name = "logjam-eb-s3-scoped"
  role = "logjam-eb-role"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "MediaAndTopoObjects"
        Effect = "Allow"
        # DeleteObjects (batch) and HeadObject are covered by DeleteObject /
        # GetObject respectively — the API's full S3 verb set on these buckets.
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [
          "arn:aws:s3:::logjam-media/*",
          "arn:aws:s3:::logjam-topo-jobs/*",
        ]
      },
      {
        Sid    = "MediaAndTopoList"
        Effect = "Allow"
        Action = "s3:ListBucket"
        Resource = [
          "arn:aws:s3:::logjam-media",
          "arn:aws:s3:::logjam-topo-jobs",
        ]
      },
      {
        # READ-ONLY, and deliberately so: the egress sweeper (lib/egressMeter.ts)
        # only ever lists and reads access-log objects to sum bytes_sent. It has
        # no reason to write or delete here, and the 30-day lifecycle rule —
        # not the API — is what reclaims the space.
        Sid    = "AccessLogsRead"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::logjam-access-logs-620853681701",
          "arn:aws:s3:::logjam-access-logs-620853681701/*",
        ]
      },
      {
        # PLATFORM, not app data. logjam-eb-role has NO AWSElasticBeanstalkWebTier
        # policy attached — AmazonS3FullAccess is currently the ONLY grant that
        # covers the EB platform bucket. EB uses the instance role to download the
        # application-version bundle on deploy/instance-replacement and to upload
        # rotated/bundle logs; without this, detaching AmazonS3FullAccess would
        # break the next deploy (delayed outage). Mirrors the S3 grant in the
        # AWS-managed AWSElasticBeanstalkWebTier policy, pinned to this one bucket.
        Sid    = "ElasticBeanstalkPlatformBucket"
        Effect = "Allow"
        Action = ["s3:Get*", "s3:List*", "s3:PutObject"]
        Resource = [
          "arn:aws:s3:::elasticbeanstalk-ap-southeast-2-620853681701",
          "arn:aws:s3:::elasticbeanstalk-ap-southeast-2-620853681701/*",
        ]
      },
    ]
  })
}

# Scoped Cognito grant. Already present live as inline policy
# `LogjamCognitoAdminUser`; codified here (same name + document) so it is
# repo-visible and survives the AmazonCognitoPowerUser detach. Because the name
# and body match the live inline policy exactly, apply is a content-identical
# PutRolePolicy upsert (no functional change), it only brings the grant into
# Terraform state.
resource "aws_iam_role_policy" "eb_cognito_admin_getuser" {
  name = "LogjamCognitoAdminUser"
  role = "logjam-eb-role"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "cognito-idp:AdminGetUser"
      Resource = "arn:aws:cognito-idp:ap-southeast-2:620853681701:userpool/ap-southeast-2_x5zPhJXMk"
    }]
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

# ARCH-001 half B: let the deploy workflow launch the pre-deploy migrate
# one-shot (aws_ecs_task_definition.api_migrate) and poll its result before the
# EB version swap. Scoped to that task def + the one cluster; PassRole limited
# to the exact execution role the task uses (no task role is passed), gated to
# ECS tasks so the deploy identity can't repurpose it elsewhere.
# INF-009: let the deploy workflows register a task-definition revision pinned
# to the image sha they just pushed (infra/scripts/pin-ecs-task-image.sh), so a
# RunTask launches a known commit instead of resolving the moving `:latest` tag.
#
# RegisterTaskDefinition supports no resource-level permission — there is no
# task-def ARN to scope to before the revision exists — so it is `*`. What that
# does NOT grant is the ability to run anything: ecs:RunTask stays scoped to
# logjam-api-migrate in the policy above, and the API's own runtime role is what
# launches the workers. The teeth are in PassRole, which is limited to the two
# roles these four task defs already use and gated to ECS tasks, so a registered
# definition cannot attach a more privileged role than the one it replaces.
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
