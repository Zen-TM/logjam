# The watchdog: the brain's outside check. The brain reports on itself
# (status.json), but a thing that is down cannot say so, and after a long
# archiving stall pgBackRest drops WAL while every check inside the brain stays
# green. This function, every 5 minutes, looks at the report, at the backup
# bucket's newest WAL object and at the public API, and fails when any of it is
# missing, stale or bad. Its codes and what to do about each:
# docs/operations/alarms.md. Source and tests: infra/lambda/brain-watchdog.
#
# Everything here exists only while the instance does (brain_instance.tf).
# Guards: tests/guards.tftest.hcl (brain_watchdog_*).
locals {
  # Where pgBackRest keeps its WAL: <repo1-path>/archive/<stanza>/. Both names
  # are set in infra/brain/postgres (pgbackrest-conf.sh, brain-entrypoint.sh);
  # guard brain_watchdog_lists_the_archive_pgbackrest_writes.
  brain_wal_prefix = "logjam/archive/logjam/"
}

# Plain Python on the runtime's own boto3: no build step, nothing to install.
data "archive_file" "brain_watchdog" {
  count = local.brain_enabled ? 1 : 0

  type             = "zip"
  source_file      = "${path.module}/../../../lambda/brain-watchdog/handler.py"
  output_path      = "${path.module}/.build/brain-watchdog.zip"
  output_file_mode = "0644"
}

resource "aws_cloudwatch_log_group" "brain_watchdog" {
  count = local.brain_enabled ? 1 : 0

  name              = "/aws/lambda/logjam-brain-watchdog"
  retention_in_days = local.operational_log_retention_days
}

resource "aws_iam_role" "brain_watchdog" {
  count = local.brain_enabled ? 1 : 0

  name = "logjam-brain-watchdog"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# It reads two small health files and lists key names under the WAL archive.
# It never reads a backup object: that is what makes it safe to hand an
# alarm. Guard: brain_watchdog_role_reads_only_the_signals.
resource "aws_iam_role_policy" "brain_watchdog" {
  count = local.brain_enabled ? 1 : 0

  name = "logjam-brain-watchdog"
  role = aws_iam_role.brain_watchdog[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadSignals"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = ["${aws_s3_bucket.brain_signals.arn}/status.json", "${aws_s3_bucket.brain_signals.arn}/drill.json"]
      },
      {
        # Key names under the WAL archive only (the function lists with a
        # delimiter: ids, directories, the newest directory).
        Sid       = "ListWalArchive"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = aws_s3_bucket.brain_backups.arn
        Condition = { StringLike = { "s3:prefix" = "${local.brain_wal_prefix}*" } }
      },
      {
        Sid      = "WriteOwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.brain_watchdog[0].arn}:*"
      },
    ]
  })
}

resource "aws_lambda_function" "brain_watchdog" {
  count = local.brain_enabled ? 1 : 0

  function_name    = "logjam-brain-watchdog"
  role             = aws_iam_role.brain_watchdog[0].arn
  runtime          = "python3.13"
  handler          = "handler.handler"
  architectures    = ["arm64"]
  filename         = data.archive_file.brain_watchdog[0].output_path
  source_code_hash = data.archive_file.brain_watchdog[0].output_base64sha256
  timeout          = 60
  memory_size      = 128

  environment {
    variables = {
      SIGNALS_BUCKET = aws_s3_bucket.brain_signals.bucket
      BACKUP_BUCKET  = aws_s3_bucket.brain_backups.bucket
      WAL_PREFIX     = local.brain_wal_prefix
      # Through CloudFront, as a user's request goes.
      READY_URL = "https://api.logjamnsw.com/ready"
    }
  }

  depends_on = [aws_cloudwatch_log_group.brain_watchdog]
}

# A failing run raises on purpose (that is what the Errors metric counts).
# Asynchronous invocations retry twice by default: one bad minute would then
# count three errors and trip the alarm by itself.
resource "aws_lambda_function_event_invoke_config" "brain_watchdog" {
  count = local.brain_enabled ? 1 : 0

  function_name          = aws_lambda_function.brain_watchdog[0].function_name
  maximum_retry_attempts = 0
}

resource "aws_cloudwatch_event_rule" "brain_watchdog" {
  count = local.brain_enabled ? 1 : 0

  name                = "logjam-brain-watchdog"
  description         = "Runs the brain's outside check every 5 minutes"
  schedule_expression = "rate(5 minutes)"
}

resource "aws_cloudwatch_event_target" "brain_watchdog" {
  count = local.brain_enabled ? 1 : 0

  rule = aws_cloudwatch_event_rule.brain_watchdog[0].name
  arn  = aws_lambda_function.brain_watchdog[0].arn
}

resource "aws_lambda_permission" "brain_watchdog" {
  count = local.brain_enabled ? 1 : 0

  statement_id  = "AllowEventBridgeSchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.brain_watchdog[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.brain_watchdog[0].arn
}

# One blip does not page: a failed check is an error in 2 of the last 3
# five-minute periods. Which check: docs/operations/alarms.md.
resource "aws_cloudwatch_metric_alarm" "brain_watchdog_checks_failing" {
  count = local.brain_enabled ? 1 : 0

  alarm_name        = "logjam-brain-checks-failing"
  alarm_description = "The brain's outside check has failed in 2 of the last 3 five-minute runs. First: read the latest line of ${aws_cloudwatch_log_group.brain_watchdog[0].name}: {\"failed\": [...]} names the failing checks, and docs/operations/alarms.md says what to do for each. ${local.alarms_doc}"

  namespace   = "AWS/Lambda"
  metric_name = "Errors"
  dimensions  = { FunctionName = aws_lambda_function.brain_watchdog[0].function_name }

  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# The check that watches the brain must itself be watched: a function that
# never runs reports nothing, so missing data is the alarm.
resource "aws_cloudwatch_metric_alarm" "brain_watchdog_dead" {
  count = local.brain_enabled ? 1 : 0

  alarm_name        = "logjam-brain-watchdog-not-running"
  alarm_description = "The brain's outside check has not run for 15 minutes, so nothing is watching the brain. First: check the EventBridge rule logjam-brain-watchdog is enabled and the function logjam-brain-watchdog exists, then read its log group for the last run. ${local.alarms_doc}"

  namespace   = "AWS/Lambda"
  metric_name = "Invocations"
  dimensions  = { FunctionName = aws_lambda_function.brain_watchdog[0].function_name }

  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# Measured on a scratch copy on 2026-11-10: the stack passed 60 requests a
# second at 50% of the instance's two vCPUs and 80 at 64%, and failed at 100
# because the API is one Node process on one core, so 50% for 15 minutes is
# about three quarters of the limit. A daily full backup (about a minute) and a
# boot do not hold 50% for 15 minutes.
resource "aws_cloudwatch_metric_alarm" "brain_cpu_high" {
  count = local.brain_enabled ? 1 : 0

  alarm_name        = "logjam-brain-cpu-high"
  alarm_description = "The brain's CPU has averaged 50% or more for 15 minutes. First: find out whether this is growth or one client misbehaving (the API's request log). The API is one process and saturates near 80 requests a second; a bigger instance of the same family adds memory, not speed. ${local.alarms_doc}"

  namespace   = "AWS/EC2"
  metric_name = "CPUUtilization"
  dimensions  = { InstanceId = aws_instance.brain[0].id }

  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 50
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}
