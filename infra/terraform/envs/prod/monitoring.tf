# CloudWatch alarms for prod health. Every alarm routes to the `logjam-alerts`
# SNS topic, whose one subscriber is the maintainer's email (local.alert_email
# in budgets.tf). docs/operations/alarms.md lists each alarm and what to do
# first when it fires.
#
# The topic and the alarms logjam-api-5xx and logjam-topo-stuck-task were made
# by hand before Terraform owned monitoring; the `import` blocks adopt them. The
# topic's email subscription is still unmanaged: its id is an ARN only AWS
# knows, and an email subscription needs a person to confirm it anyway. The
# topic's policy is the AWS default, which lets CloudWatch alarms in this
# account publish; nothing else publishes to it.

import {
  to = aws_sns_topic.alerts
  id = "arn:aws:sns:ap-southeast-2:620853681701:logjam-alerts"
}

resource "aws_sns_topic" "alerts" {
  name = "logjam-alerts"
}

# RDS is a db.t3.micro on 20 GB gp2. Storage autoscaling IS enabled
# (max_allocated_storage = 100 in rds.tf, cap 100 GB) but only grows on
# demand — it doesn't warn you it's happening. Warn early — 4 GiB free ≈ 80%
# used — to leave time to notice before disk actually runs out.
# FreeStorageSpace is reported in bytes.
resource "aws_cloudwatch_metric_alarm" "rds_free_storage_low" {
  alarm_name        = "logjam-rds-free-storage-low"
  alarm_description = "RDS ${aws_db_instance.main.identifier} free storage below 4 GiB — extend storage or enable autoscaling before it hits zero."

  namespace   = "AWS/RDS"
  metric_name = "FreeStorageSpace"
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }

  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "LessThanThreshold"
  threshold           = 4 * 1024 * 1024 * 1024 # 4 GiB
  treat_missing_data  = "missing"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# db.t3.micro is CPU-burstable; sustained saturation means the DB is the
# bottleneck and API latency will climb. High threshold + 15 min sustained keeps
# normal query bursts from firing it.
resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name        = "logjam-rds-cpu-high"
  alarm_description = "RDS ${aws_db_instance.main.identifier} CPU above 90% for 15 min — database-bound; investigate slow queries or resize."

  namespace   = "AWS/RDS"
  metric_name = "CPUUtilization"
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }

  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 90
  treat_missing_data  = "missing"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# The pgaudit -> WORM pipeline's only health signal. INF-001: the CloudWatch
# subscription filter fed this stream from a log group that stopped existing at
# the 2026-06-23 DB rename, so the stream sat ACTIVE and idle for two months
# while the CloudTrail half kept writing to the same bucket — the audit sink
# looked alive from every angle except the one nobody checked.
#
# A starved Firehose emits NO datapoints rather than bad ones, so
# treat_missing_data = "breaching" is the entire point of this alarm: absence of
# data IS the failure. 24 h at one 24 h period, because pgaudit volume is bursty
# (log_connections plus operator sessions) and a shorter window would flap
# overnight.
resource "aws_cloudwatch_metric_alarm" "pgaudit_delivery_stalled" {
  alarm_name        = "logjam-pgaudit-delivery-stalled"
  alarm_description = "No pgaudit records reached the WORM audit stream in 24h — the CloudWatch subscription filter or the RDS log export is broken (see audit.tf, INF-001)."

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
  # The API's stdout (pino JSON). EB names and creates this group, so it is
  # referenced by name, never managed (logging.tf's header).
  eb_api_stdout_log_group = "/aws/elasticbeanstalk/${aws_elastic_beanstalk_environment.api.name}/var/log/eb-docker/containers/eb-current-app/stdouterr.log"

  alarms_doc = "https://github.com/Zen-TM/logjam/blob/main/docs/operations/alarms.md"
}

# ── API ────────────────────────────────────────────────────────────────────

# Counted from the API's own request log (pino-http's `res.statusCode`), not
# CloudFront's 5xxErrorRate: CloudFront publishes only in us-east-1, where this
# topic cannot be an alarm action, and a rate over a handful of requests is
# 100% after one failure. A dead container writes no log line, so it cannot
# raise this count; api_environment_degraded below covers that case.
resource "aws_cloudwatch_log_metric_filter" "api_5xx" {
  name           = "logjam-api-5xx"
  log_group_name = local.eb_api_stdout_log_group
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

# The crash-loop and dead-instance case the 5xx count cannot see. Enhanced
# health publishes EnvironmentHealth free: 0 Ok, 1 Info, 5 Unknown, 10 No data,
# 15 Warning, 20 Degraded, 25 Severe. Degraded or worse in every minute of ten:
# a deploy's cold restart is Severe for a minute or two, so a shorter window
# would page on every release. Maximum, not Minimum, so a container that
# restarts and dies again inside each minute still counts.
resource "aws_cloudwatch_metric_alarm" "api_environment_degraded" {
  alarm_name        = "logjam-api-environment-degraded"
  alarm_description = "Elastic Beanstalk ${aws_elastic_beanstalk_environment.api.name} has been Degraded or Severe for 10 minutes. First: read the environment's health causes (console or `aws elasticbeanstalk describe-environment-health --environment-name ${aws_elastic_beanstalk_environment.api.name} --attribute-names All`); if a deploy just ran, roll it back (docs/operations/rollback.md). ${local.alarms_doc}"

  namespace   = "AWS/ElasticBeanstalk"
  metric_name = "EnvironmentHealth"
  dimensions = {
    EnvironmentName = aws_elastic_beanstalk_environment.api.name
  }

  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 20
  treat_missing_data  = "missing"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ── Workers ────────────────────────────────────────────────────────────────

# Adopted as it was made by hand; the settings are the live ones. Despite the
# name it watches the whole cluster: some task (any family) has been running in
# every hour of the last six.
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
# code and ECS's reason. The events carry task and job ids, never user data
# (the only override is the job id env var, api/src/lib/ecsRunTask.ts). A
# metric filter on the worker log groups was the other option; an OOM-killed
# task logs nothing.
resource "aws_cloudwatch_log_group" "worker_failures" {
  name              = "/aws/events/logjam-worker-failures"
  retention_in_days = 90
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
# export_worker.py, geoPdfWorker.ts), so one bad upload is one failure, and a
# user retrying it twice more is worth a look too. Jobs are rare, so a broken
# worker image may take hours to fail three times; the user is told of each
# failure meanwhile.
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
