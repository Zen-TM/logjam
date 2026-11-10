# A cost ceiling with a breaker AWS itself pulls: when a month's actual spend
# reaches var.cost_ceiling_usd, AWS Budgets attaches a deny policy to the roles
# that launch workers and sign uploads. No code of ours has to be alive for it.
# It is a backstop under the compute pool's polite refusals, and crude on
# purpose: a job request then fails instead of being refused nicely. It should
# never fire in a normal month. budgets.tf's `logjam-monthly` is the early
# warning and is left as it is.
#
# The budget's figures lag by hours, so the breaker is late by design.
# What fired and how to undo it: docs/operations/alarms.md.

variable "cost_ceiling_usd" {
  description = "Monthly spend, before tax, at which AWS Budgets attaches the cost-ceiling deny policy."
  type        = number
  default     = 100
}

locals {
  # Literal, as everywhere else in this root: the role is Elastic Beanstalk's
  # (iam.tf), not a resource here.
  cost_ceiling_roles = {
    eb    = { name = "logjam-eb-role", arn = "arn:aws:iam::620853681701:role/logjam-eb-role" }
    brain = { name = aws_iam_role.brain.name, arn = aws_iam_role.brain.arn }
  }
}

resource "aws_budgets_budget" "ceiling" {
  name         = "logjam-ceiling"
  budget_type  = "COST"
  limit_amount = tostring(var.cost_ceiling_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # The provider's defaults count every cost type, as logjam-monthly does. This
  # budget differs in one field, include_tax = false: the ceiling is a pre-tax
  # figure (GST is added on the invoice, not something usage can run up).
  cost_types {
    include_tax = false
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    notification_type         = "ACTUAL"
    threshold                 = 80
    threshold_type            = "PERCENTAGE"
    subscriber_sns_topic_arns = [aws_sns_topic.budget_alerts.arn]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    notification_type         = "FORECASTED"
    threshold                 = 100
    threshold_type            = "PERCENTAGE"
    subscriber_sns_topic_arns = [aws_sns_topic.budget_alerts.arn]
  }
}

# Denies only what a runaway bill is made of: starting workers, and writing to
# the two upload buckets. Downloads and reads keep working and running jobs
# finish. S3 evaluates a presigned URL as its signer when the URL is used, so
# upload URLs already handed out stop too, and multipart parts are authorised
# by s3:PutObject (there is no s3:UploadPart action):
#   https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
#   https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html#mpuAndPermissions
#
# NEVER widen the S3 resources: the brain's role is shared by the API and by
# pgBackRest, and a deny on the backup or signals bucket would stop WAL
# archiving and turn a cost alarm into data loss.
# Guard: tests/guards.tftest.hcl (cost_ceiling_denies_only_workers_and_uploads).
resource "aws_iam_policy" "cost_ceiling_deny" {
  name        = "logjam-cost-ceiling-deny"
  description = "Attached by the logjam-ceiling budget action: no new worker tasks, no uploads."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "NoNewWorkers"
        Effect   = "Deny"
        Action   = "ecs:RunTask"
        Resource = "arn:aws:ecs:ap-southeast-2:620853681701:task-definition/*"
      },
      {
        Sid    = "NoUploads"
        Effect = "Deny"
        Action = "s3:PutObject"
        Resource = [
          "arn:aws:s3:::logjam-media/*",
          "arn:aws:s3:::logjam-topo-jobs/*",
        ]
      },
    ]
  })
}

# The role Budgets assumes. It can attach and detach this one policy on the two
# roles above and nothing else; the trust names Budgets in this account only
# (AWS documents the SourceArn as budget/* for Budgets):
#   https://docs.aws.amazon.com/cost-management/latest/userguide/cross-service-confused-deputy-prevention.html
# Guard: tests/guards.tftest.hcl (cost_ceiling_role_attaches_only_the_deny).
resource "aws_iam_role" "budget_breaker" {
  name        = "logjam-budget-breaker"
  description = "Assumed by AWS Budgets to attach the cost-ceiling deny policy."
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "budgets.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = "620853681701" }
        ArnLike      = { "aws:SourceArn" = "arn:aws:budgets::620853681701:budget/*" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "budget_breaker" {
  name = "attach-cost-ceiling-deny"
  role = aws_iam_role.budget_breaker.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
      Resource = [for r in local.cost_ceiling_roles : r.arn]
      Condition = {
        ArnEquals = { "iam:PolicyARN" = aws_iam_policy.cost_ceiling_deny.arn }
      }
    }]
  })
}

resource "aws_budgets_budget_action" "ceiling" {
  budget_name        = aws_budgets_budget.ceiling.name
  action_type        = "APPLY_IAM_POLICY"
  approval_model     = "AUTOMATIC"
  notification_type  = "ACTUAL"
  execution_role_arn = aws_iam_role.budget_breaker.arn

  action_threshold {
    action_threshold_type  = "PERCENTAGE"
    action_threshold_value = 100
  }

  definition {
    iam_action_definition {
      policy_arn = aws_iam_policy.cost_ceiling_deny.arn
      roles      = [for r in local.cost_ceiling_roles : r.name]
    }
  }

  subscriber {
    subscription_type = "SNS"
    address           = aws_sns_topic.budget_alerts.arn
  }

  # Budgets reads the role when it saves the action.
  depends_on = [aws_iam_role_policy.budget_breaker]
}
