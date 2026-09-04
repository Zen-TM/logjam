# Account-level cost guardrail — the outermost backstop, below which every
# per-user limit (compute credits, storage, egress) is a refinement.
#
# The budget itself pre-dates Terraform: it was created in the console in
# 2026-06 and lived as drift until now. The `import` block below adopts the
# LIVE resource rather than creating a second one, so this file must keep
# matching what is deployed (name, limit, start date) or the import fails.
#
# Why this matters (2026-09-03): the live budget had ACTUAL notifications at
# 80% and 100% and NO forecast notification. Actual spend was $3.67 while the
# month was forecast at $48.46 against the $50 limit — i.e. the account was
# projected to blow the budget and not one alert would have fired until the
# money was already gone. FORECASTED is the only notification here that warns
# before the spend happens.

locals {
  # The one human who reads these. Also the confirmed subscriber on the
  # ap-southeast-2 `logjam-alerts` topic (monitoring.tf) — kept as a literal in
  # both places because there is no variables.tf in this root.
  alert_email = "zentmarcos@gmail.com"
}

# AWS Budgets can only publish to an SNS topic in us-east-1, so this cannot
# reuse the ap-southeast-2 `logjam-alerts` topic the CloudWatch alarms use.
# Keeping it separate also means the budget path never touches that topic's
# policy, which is still the AWS default and is load-bearing for those alarms.
resource "aws_sns_topic" "budget_alerts" {
  provider = aws.us_east_1
  name     = "logjam-budget-alerts"
}

# Email is what a human actually reads. The topic exists so an automated
# response (a throttle Lambda that flips the app into read-only, say) can be
# attached later without editing the budget itself.
resource "aws_sns_topic_subscription" "budget_alerts_email" {
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "email"
  endpoint  = local.alert_email
}

# Budgets publishes as a service principal, which the default topic policy's
# account-scoped `AWS:SourceOwner` condition does NOT cover — without this
# statement the SNS notifications silently never arrive.
resource "aws_sns_topic_policy" "budget_alerts" {
  provider = aws.us_east_1
  arn      = aws_sns_topic.budget_alerts.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowBudgetsPublish"
        Effect    = "Allow"
        Principal = { Service = "budgets.amazonaws.com" }
        Action    = "SNS:Publish"
        Resource  = aws_sns_topic.budget_alerts.arn
        Condition = {
          StringEquals = { "aws:SourceAccount" = "620853681701" }
        }
      },
    ]
  })
}

import {
  to = aws_budgets_budget.monthly
  id = "620853681701:logjam-monthly"
}

resource "aws_budgets_budget" "monthly" {
  name         = "logjam-monthly"
  budget_type  = "COST"
  limit_amount = "50"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Matches the live budget's creation date (2026-06-01T00:00Z). Changing this
  # forces replacement of an imported resource — don't.
  time_period_start = "2026-06-01_00:00"

  # cost_types is deliberately omitted: the provider defaults (all include_*
  # true, use_blended / use_amortized false) already match the live budget
  # exactly, so declaring them would add noise without changing anything.

  # Something is trending wrong — still recoverable this month.
  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = [local.alert_email]
    subscriber_sns_topic_arns  = [aws_sns_topic.budget_alerts.arn]
  }

  # The month has already overrun. Informational by the time it fires.
  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = [local.alert_email]
    subscriber_sns_topic_arns  = [aws_sns_topic.budget_alerts.arn]
  }

  # The one that fires BEFORE the money is spent. This is the notification the
  # live budget was missing.
  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "FORECASTED"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = [local.alert_email]
    subscriber_sns_topic_arns  = [aws_sns_topic.budget_alerts.arn]
  }
}
