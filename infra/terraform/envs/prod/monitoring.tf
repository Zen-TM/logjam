# CloudWatch alarms for prod health. Every alarm routes to the `logjam-alerts`
# SNS topic, whose one subscriber is the maintainer's email (local.alert_email
# in budgets.tf). docs/operations/alarms.md lists each alarm and what to do
# first when it fires.
#
# The topic and the alarms logjam-api-5xx and logjam-topo-stuck-task are
# imported into Terraform. The topic's email subscription is unmanaged: its id
# is an ARN only AWS knows, and an email subscription needs a person to confirm
# it anyway. The topic's policy is the AWS default, which lets CloudWatch alarms
# in this account publish; nothing else publishes to it.

import {
  to = aws_sns_topic.alerts
  id = "arn:aws:sns:ap-southeast-2:620853681701:logjam-alerts"
}

resource "aws_sns_topic" "alerts" {
  name = "logjam-alerts"
  tags = { drill = "apply-refusal" }
}

# The pgaudit -> WORM pipeline's only health signal. If the log group or
# subscription filter breaks, the Firehose stream sits ACTIVE and idle while
# CloudTrail continues writing to the bucket — an idle stream can appear healthy
# without an explicit delivery check.
#
# A starved Firehose emits NO datapoints rather than bad ones, so
# treat_missing_data = "breaching" is the entire point of this alarm: absence of
# data IS the failure. 24 h at one 24 h period, because pgaudit volume is bursty
# (log_connections plus operator sessions) and a shorter window would flap
# overnight.
resource "aws_cloudwatch_metric_alarm" "pgaudit_delivery_stalled" {
  alarm_name        = "logjam-pgaudit-delivery-stalled"
  alarm_description = "No pgaudit records reached the WORM audit stream in 24h — the CloudWatch subscription filter or the brain's Postgres log is broken (see audit.tf and brain_logs.tf)."

  namespace   = "AWS/Firehose"
  metric_name = "IncomingBytes"
  dimensions = {
    DeliveryStreamName = aws_kinesis_firehose_delivery_stream.pgaudit.name
  }

  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = 1
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

locals {
  # The group of the API's request log, for the filters that read it. The
  # brain's container logs through Docker's awslogs driver, which ships each
  # stdout line as one event: the pino JSON line the filter patterns match. A
  # filter's group is fixed at creation: moving it replaces the filter, a few
  # seconds without a datapoint.
  api_log_group = aws_cloudwatch_log_group.brain_api.name

  alarms_doc = "https://github.com/Zen-TM/logjam/blob/main/docs/operations/alarms.md"
}

# ── API ────────────────────────────────────────────────────────────────────

# Counted from the API's own request log (pino-http's `res.statusCode`), not
# CloudFront's 5xxErrorRate: CloudFront publishes only in us-east-1, where this
# topic cannot be an alarm action, and a rate over a handful of requests is
# 100% after one failure. A dead container writes no log line, so it cannot
# raise this count; the watchdog (brain_watchdog.tf) and the instance's
# status-check alarms (brain_alarms.tf) cover that case.
resource "aws_cloudwatch_log_metric_filter" "api_5xx" {
  name           = "logjam-api-5xx"
  log_group_name = local.api_log_group
  pattern        = "{ $.res.statusCode >= 500 }"

  metric_transformation {
    namespace = "Logjam/Api"
    name      = "Responses5xx"
    value     = "1"
  }
}

import {
  to = aws_cloudwatch_metric_alarm.api_5xx
  id = "logjam-api-5xx"
}

# At least 10 5xx in two of three 5-minute windows. One phone whose sync keeps
# failing retries on a 1 s → 5 min backoff (computeBackoffMs in
# shared/src/syncClient.ts): about ten requests in its first few minutes, then
# one every few minutes, so it can fill one window but not two. A broken
# release fails every request from every open app and fills them all. Traffic
# is small, so the threshold is a count: at 2 a.m. nothing may be sent at all,
# and nothing then is not a failure.
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name        = "logjam-api-5xx"
  alarm_description = "The API returned 10+ 5xx responses in two of the last three 5-minute windows. First: check whether a deploy just ran and failed its smoke test; if a release is to blame, roll it back (docs/operations/rollback.md). ${local.alarms_doc}"

  namespace   = aws_cloudwatch_log_metric_filter.api_5xx.metric_transformation[0].namespace
  metric_name = aws_cloudwatch_log_metric_filter.api_5xx.metric_transformation[0].name

  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 10
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ── Workers ────────────────────────────────────────────────────────────────

# Despite the name it watches the whole cluster: some task (any family) has
# been running in every hour of the last six.
import {
  to = aws_cloudwatch_metric_alarm.topo_stuck_task
  id = "logjam-topo-stuck-task"
}

resource "aws_cloudwatch_metric_alarm" "topo_stuck_task" {
  alarm_name        = "logjam-topo-stuck-task"
  alarm_description = "Some task in the ECS cluster has been running in every hour of the last six, which no job should. First: find which (ECS console, cluster logjam-cluster, running tasks), its job in its log group, and whether the reaper stopped it (api/src/lib/topoJobReaper.ts); stop the task by hand if not. ${local.alarms_doc}"

  namespace   = "ECS/ContainerInsights"
  metric_name = "RunningTaskCount"
  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
  }

  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 6
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# Worker tasks that stop badly: a non-zero exit (a job that failed, an OOM
# kill's 137) or a task that never started (image pull, secrets). Stops the
# reaper asks for are left out (stopCode UserInitiated). The ECS event is
# written to a log group and counted from there, rather than sent to the topic
# directly: an email per failed job is not an alarm, and ECS forgets a stopped
# task after about an hour, while this log keeps which family failed, its exit
# code and ECS's reason. The events carry task and job ids, never user data:
# the API's only override is the job id env var (api/src/lib/ecsRunTask.ts).
# A maintainer announcement (docs/operations/announcements.md) is a by-hand
# RunTask whose overrides are the script's command and the message, the
# maintainer's own text; a refused or failed one also counts here. A
# metric filter on the worker log groups was the other option; an OOM-killed
# task logs nothing.
resource "aws_cloudwatch_log_group" "worker_failures" {
  name              = "/aws/events/logjam-worker-failures"
  retention_in_days = local.operational_log_retention_days
}

resource "aws_cloudwatch_event_rule" "worker_failures" {
  name        = "logjam-worker-failures"
  description = "ECS tasks in ${aws_ecs_cluster.main.name} that stopped with a non-zero exit or failed to start."

  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.main.arn]
      lastStatus = ["STOPPED"]
      "$or" = [
        {
          stopCode   = [{ "anything-but" = ["UserInitiated"] }]
          containers = { exitCode = [{ "anything-but" = 0 }] }
        },
        { stopCode = ["TaskFailedToStart"] },
      ]
    }
  })
}

resource "aws_cloudwatch_event_target" "worker_failures" {
  rule = aws_cloudwatch_event_rule.worker_failures.name
  arn  = aws_cloudwatch_log_group.worker_failures.arn
}

data "aws_iam_policy_document" "worker_failures_logs" {
  statement {
    actions   = ["logs:CreateLogStream"]
    resources = ["${aws_cloudwatch_log_group.worker_failures.arn}:*"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com", "delivery.logs.amazonaws.com"]
    }
  }

  statement {
    actions   = ["logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.worker_failures.arn}:*:*"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com", "delivery.logs.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.worker_failures.arn]
    }
  }
}

resource "aws_cloudwatch_log_resource_policy" "worker_failures" {
  policy_name     = "logjam-worker-failures-events"
  policy_document = data.aws_iam_policy_document.worker_failures_logs.json
}

resource "aws_cloudwatch_log_metric_filter" "worker_failures" {
  name           = "logjam-worker-failures"
  log_group_name = aws_cloudwatch_log_group.worker_failures.name
  pattern        = "{ $.detail.lastStatus = \"STOPPED\" }"

  metric_transformation {
    namespace = "Logjam/Workers"
    name      = "FailedTasks"
    value     = "1"
  }
}

# Three in an hour. Every failed job exits 1 (topo/worker.py,
# topo/export_worker.py), so one bad upload is
# one failure, and a user retrying it twice more is worth a look too. Jobs are
# rare, so a broken worker image may take hours to fail three times; the user
# is told of each failure meanwhile.
resource "aws_cloudwatch_metric_alarm" "worker_failures" {
  alarm_name        = "logjam-worker-failures"
  alarm_description = "3+ ECS worker tasks stopped with a non-zero exit or failed to start within an hour. First: read ${aws_cloudwatch_log_group.worker_failures.name} for the family, exit code and stoppedReason, then that worker's log group (/ecs/<family>); if a worker deploy just ran, roll the worker back (docs/operations/rollback.md). ${local.alarms_doc}"

  namespace   = aws_cloudwatch_log_metric_filter.worker_failures.metric_transformation[0].namespace
  metric_name = aws_cloudwatch_log_metric_filter.worker_failures.metric_transformation[0].name

  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 3
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ── Place registry ─────────────────────────────────────────────────────────

# The monthly build (ecs.tf) runs once, so one failure is the alarm, not
# worker_failures' three an hour. Its failed stops already reach that log
# group through the rule above; this counts them on their own.
resource "aws_cloudwatch_log_metric_filter" "place_registry_failures" {
  name           = "logjam-place-registry-failures"
  log_group_name = aws_cloudwatch_log_group.worker_failures.name
  pattern        = "{ $.detail.group = \"family:${aws_ecs_task_definition.place_registry.family}\" }"

  metric_transformation {
    namespace = "Logjam/Workers"
    name      = "PlaceRegistryFailures"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "place_registry_failed" {
  alarm_name        = "logjam-place-registry-failed"
  alarm_description = "The monthly place registry build stopped with a non-zero exit or failed to start; the published registry is unchanged. First: read ${aws_cloudwatch_log_group.worker_failures.name} for its exit code and stoppedReason, then ${aws_cloudwatch_log_group.place_registry.name}. ${local.alarms_doc}"

  namespace   = aws_cloudwatch_log_metric_filter.place_registry_failures.metric_transformation[0].namespace
  metric_name = aws_cloudwatch_log_metric_filter.place_registry_failures.metric_transformation[0].name

  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# A run that never starts leaves no ECS event: the scheduler's RunTask call
# itself failed (a role, a subnet, the task definition). Any target error
# alarms, including one a retry then got past, since the next chance is a
# month away. The metric's only dimension is the schedule group, which holds
# just this schedule.
resource "aws_cloudwatch_metric_alarm" "place_registry_not_launched" {
  alarm_name        = "logjam-place-registry-not-launched"
  alarm_description = "EventBridge Scheduler could not launch the monthly place registry build (RunTask returned an error). First: check whether a ${aws_ecs_task_definition.place_registry.family} task ran anyway after a retry; if not, read the RunTask error in CloudTrail (event RunTask by role ${aws_iam_role.place_registry_scheduler.name}). ${local.alarms_doc}"

  namespace   = "AWS/Scheduler"
  metric_name = "TargetErrorCount"
  dimensions = {
    ScheduleGroup = aws_scheduler_schedule.place_registry.group_name
  }

  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ── River gauges ───────────────────────────────────────────────────────────

# A run that fails before publishing leaves the readings as they were, and
# clients show their age; a cold sweep failing part way publishes the hot
# readings first, then exits non-zero. One failure alarms: the job runs every two hours, and a key or a
# WaterNSW outage should be known before the readings go a day stale.
resource "aws_cloudwatch_log_metric_filter" "gauges_failures" {
  name           = "logjam-gauges-failures"
  log_group_name = aws_cloudwatch_log_group.worker_failures.name
  pattern        = "{ $.detail.group = \"family:${aws_ecs_task_definition.gauges.family}\" }"

  metric_transformation {
    namespace = "Logjam/Workers"
    name      = "GaugesFailures"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "gauges_failed" {
  alarm_name        = "logjam-gauges-failed"
  alarm_description = "The river gauges job stopped with a non-zero exit or failed to start; the published readings may be unchanged and getting older. First: read ${aws_cloudwatch_log_group.worker_failures.name} for its exit code and stoppedReason, then ${aws_cloudwatch_log_group.gauges.name}. ${local.alarms_doc}"

  namespace   = aws_cloudwatch_log_metric_filter.gauges_failures.metric_transformation[0].namespace
  metric_name = aws_cloudwatch_log_metric_filter.gauges_failures.metric_transformation[0].name

  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# The scheduler's RunTask call itself failed. The dimension is the schedule
# group, which holds just this schedule: the place registry has its own.
resource "aws_cloudwatch_metric_alarm" "gauges_not_launched" {
  alarm_name        = "logjam-gauges-not-launched"
  alarm_description = "EventBridge Scheduler could not launch the river gauges job (RunTask returned an error). First: check whether a ${aws_ecs_task_definition.gauges.family} task ran anyway after a retry; if not, read the RunTask error in CloudTrail (event RunTask by role ${aws_iam_role.gauges_scheduler.name}). ${local.alarms_doc}"

  namespace   = "AWS/Scheduler"
  metric_name = "TargetErrorCount"
  dimensions = {
    ScheduleGroup = aws_scheduler_schedule.gauges.group_name
  }

  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ── Fire history ───────────────────────────────────────────────────────────

# The monthly build (ecs.tf) runs once, so one failure is the alarm, as for
# the place registry. A short read of the service exits non-zero with the
# published raster left in place.
resource "aws_cloudwatch_log_metric_filter" "fire_history_failures" {
  name           = "logjam-fire-history-failures"
  log_group_name = aws_cloudwatch_log_group.worker_failures.name
  pattern        = "{ $.detail.group = \"family:${aws_ecs_task_definition.fire_history.family}\" }"

  metric_transformation {
    namespace = "Logjam/Workers"
    name      = "FireHistoryFailures"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "fire_history_failed" {
  alarm_name        = "logjam-fire-history-failed"
  alarm_description = "The monthly fire history build stopped with a non-zero exit or failed to start; the published raster is unchanged and a month older. First: read ${aws_cloudwatch_log_group.worker_failures.name} for its exit code and stoppedReason, then ${aws_cloudwatch_log_group.fire_history.name}. ${local.alarms_doc}"

  namespace   = aws_cloudwatch_log_metric_filter.fire_history_failures.metric_transformation[0].namespace
  metric_name = aws_cloudwatch_log_metric_filter.fire_history_failures.metric_transformation[0].name

  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# The scheduler's RunTask call itself failed. The dimension is the schedule
# group, which holds just this schedule.
resource "aws_cloudwatch_metric_alarm" "fire_history_not_launched" {
  alarm_name        = "logjam-fire-history-not-launched"
  alarm_description = "EventBridge Scheduler could not launch the monthly fire history build (RunTask returned an error). First: check whether a ${aws_ecs_task_definition.fire_history.family} task ran anyway after a retry; if not, read the RunTask error in CloudTrail (event RunTask by role ${aws_iam_role.fire_history_scheduler.name}). ${local.alarms_doc}"

  namespace   = "AWS/Scheduler"
  metric_name = "TargetErrorCount"
  dimensions = {
    ScheduleGroup = aws_scheduler_schedule.fire_history.group_name
  }

  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ── Coverage ───────────────────────────────────────────────────────────────

# The monthly build (ecs.tf) runs once, so one failure is the alarm, as for
# the place registry. A release caught mid-upload, or a map with nothing in
# NSW, exits non-zero with the published archive left in place.
resource "aws_cloudwatch_log_metric_filter" "coverage_failures" {
  name           = "logjam-coverage-failures"
  log_group_name = aws_cloudwatch_log_group.worker_failures.name
  pattern        = "{ $.detail.group = \"family:${aws_ecs_task_definition.coverage.family}\" }"

  metric_transformation {
    namespace = "Logjam/Workers"
    name      = "CoverageFailures"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "coverage_failed" {
  alarm_name        = "logjam-coverage-failed"
  alarm_description = "The monthly coverage build stopped with a non-zero exit or failed to start; the published archive is unchanged and a release behind. First: read ${aws_cloudwatch_log_group.worker_failures.name} for its exit code and stoppedReason, then ${aws_cloudwatch_log_group.coverage.name}. ${local.alarms_doc}"

  namespace   = aws_cloudwatch_log_metric_filter.coverage_failures.metric_transformation[0].namespace
  metric_name = aws_cloudwatch_log_metric_filter.coverage_failures.metric_transformation[0].name

  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# The scheduler's RunTask call itself failed. The dimension is the schedule
# group, which holds just this schedule.
resource "aws_cloudwatch_metric_alarm" "coverage_not_launched" {
  alarm_name        = "logjam-coverage-not-launched"
  alarm_description = "EventBridge Scheduler could not launch the monthly coverage build (RunTask returned an error). First: check whether a ${aws_ecs_task_definition.coverage.family} task ran anyway after a retry; if not, read the RunTask error in CloudTrail (event RunTask by role ${aws_iam_role.coverage_scheduler.name}). ${local.alarms_doc}"

  namespace   = "AWS/Scheduler"
  metric_name = "TargetErrorCount"
  dimensions = {
    ScheduleGroup = aws_scheduler_schedule.coverage.group_name
  }

  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}
