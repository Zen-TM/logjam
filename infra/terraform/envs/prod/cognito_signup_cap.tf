# A monthly cap on new accounts, so Cognito's bill has a ceiling. Cognito bills
# a user active for the month they sign up, confirmed or not, and its own
# sign-up limit (50 a second for the account) would allow millions a month;
# nothing in front of Cognito's endpoints bounds that. A pre sign-up Lambda
# counts self-service sign-ups in DynamoDB and refuses them at the cap; an
# attacker who fills it blocks new sign-ups until the 1st but runs up no bill.
# Existing users and administrator-created accounts are untouched.
#
# The function source lives in infra/lambda/cognito-pre-signup and is built the
# way cognito-email-sender is (lambda_cognito_email.tf).

variable "signup_cap_per_month" {
  type        = number
  default     = 9000
  description = "Self-service sign-ups Cognito may accept per UTC calendar month."

  # The cap counts accounts created in a month. Cognito bills active users: the
  # 10,000 a month on the Essentials tier are free, and existing users who sign
  # in count too (21 today). The bill stays at zero while existing users stay
  # under about 1,000; raise this only after checking the real figure.
  validation {
    condition     = var.signup_cap_per_month >= 1 && var.signup_cap_per_month <= 9000
    error_message = "signup_cap_per_month must be between 1 and 9000 (the Essentials free tier is 10,000 active users)."
  }
}

data "archive_file" "cognito_pre_signup" {
  type             = "zip"
  source_dir       = "${path.module}/../../../lambda/cognito-pre-signup/dist"
  output_path      = "${path.module}/.build/cognito-pre-signup.zip"
  output_file_mode = "0644"
}

# One item per month ("YYYY-MM"), attribute n. No user data.
#
# Protected from deletion: the function fails open when the table is missing,
# so deleting it lifts the cap. Guard: guards.tftest.hcl
# (signup_cap_counter_table_cannot_be_deleted).
resource "aws_dynamodb_table" "signup_counter" {
  name                        = "logjam-signup-counter"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "month"
  deletion_protection_enabled = true

  attribute {
    name = "month"
    type = "S"
  }
}

resource "aws_cloudwatch_log_group" "cognito_pre_signup" {
  name              = "/aws/lambda/logjam-cognito-pre-signup"
  retention_in_days = local.operational_log_retention_days
}

# Its own logs and the one UpdateItem, nothing else. No managed policy: the
# basic-execution one adds logs:CreateLogGroup on every group. Guard for the
# inline policy: guards.tftest.hcl (signup_cap_role_does_one_update_and_writes_its_logs);
# a managed attachment is not something it can see.
resource "aws_iam_role" "cognito_pre_signup" {
  name = "logjam-cognito-pre-signup-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "cognito_pre_signup" {
  name = "logjam-cognito-pre-signup"
  role = aws_iam_role.cognito_pre_signup.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "CountSignUp"
        Effect   = "Allow"
        Action   = "dynamodb:UpdateItem"
        Resource = aws_dynamodb_table.signup_counter.arn
      },
      {
        Sid      = "WriteOwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.cognito_pre_signup.arn}:*"
      },
    ]
  })
}

# Cognito gives a trigger 5 seconds, so a longer timeout buys nothing. 256 MB:
# CPU scales with memory, and a cold start on 128 MB is where a TLS connect to
# DynamoDB runs slow. JSON logs: the count line is an object the metric filter
# below reads.
resource "aws_lambda_function" "cognito_pre_signup" {
  function_name    = "logjam-cognito-pre-signup"
  role             = aws_iam_role.cognito_pre_signup.arn
  runtime          = aws_lambda_function.cognito_email_sender.runtime
  handler          = "index.handler"
  filename         = data.archive_file.cognito_pre_signup.output_path
  source_code_hash = data.archive_file.cognito_pre_signup.output_base64sha256
  timeout          = 5
  memory_size      = 256

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.signup_counter.name
      SIGNUP_CAP = tostring(var.signup_cap_per_month)
    }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.cognito_pre_signup.name
  }

  depends_on = [aws_iam_role_policy.cognito_pre_signup]
}

resource "aws_lambda_permission" "cognito_pre_signup_invoke" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cognito_pre_signup.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}

# ── Alarms ─────────────────────────────────────────────────────────────────

# The count line is {"message": {"msg": "signup_counted", "n": ..., "cap": ...}}
# under Lambda's JSON log format. The metric is the month's count, so Maximum
# is the latest.
resource "aws_cloudwatch_log_metric_filter" "signup_counted" {
  name           = "logjam-signup-counted"
  log_group_name = aws_cloudwatch_log_group.cognito_pre_signup.name
  pattern        = "{ $.message.msg = \"signup_counted\" }"

  metric_transformation {
    namespace = "Logjam/Signup"
    name      = "SignupsThisMonth"
    value     = "$.message.n"
  }
}

# A day-long period and treat_missing_data = "ignore" hold the alarm in ALARM
# through quiet days: the metric only has a point when a sign-up is counted, and
# once the cap is full none are. It clears at the first counted sign-up of the
# next month (a low count), not on the 1st itself; a month with no sign-ups
# leaves it up.
resource "aws_cloudwatch_metric_alarm" "signup_cap_80_percent" {
  alarm_name        = "logjam-signup-cap-80-percent"
  alarm_description = "Sign-ups this month reached 80% of the cap (${floor(var.signup_cap_per_month * 0.8)} of ${var.signup_cap_per_month}). At the cap Logjam stops taking new accounts until the 1st. First: decide whether this is real growth or an attack, and whether to raise the cap (docs/operations/alarms.md). ${local.alarms_doc}"

  namespace   = aws_cloudwatch_log_metric_filter.signup_counted.metric_transformation[0].namespace
  metric_name = aws_cloudwatch_log_metric_filter.signup_counted.metric_transformation[0].name

  statistic           = "Maximum"
  period              = 86400
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = floor(var.signup_cap_per_month * 0.8)
  treat_missing_data  = "ignore"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# A refused sign-up is a thrown error to Lambda, so this also fires when the
# cap is full. A broken trigger (a crash, a timeout) fails real sign-ups the
# same way, and Cognito shows both to the person as the same kind of error.
resource "aws_cloudwatch_metric_alarm" "signup_trigger_errors" {
  alarm_name        = "logjam-signup-trigger-errors"
  alarm_description = "The pre sign-up function returned an error. Either the monthly cap is full or the trigger is broken and failing sign-ups. First: read the latest signup_counted count against the cap, then the function's log group (docs/operations/alarms.md). ${local.alarms_doc}"

  namespace   = "AWS/Lambda"
  metric_name = "Errors"
  dimensions = {
    FunctionName = aws_lambda_function.cognito_pre_signup.function_name
  }

  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}
