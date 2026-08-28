# CloudWatch alarms for prod health. Route to the existing `logjam-alerts` SNS
# topic (confirmed email subscription → zentmarcos@gmail.com).
#
# NOTE: two pre-existing alarms (logjam-api-5xx, logjam-topo-stuck-task) and the
# logjam-alerts topic itself were created out-of-band and are NOT yet Terraform-
# managed (drift). This file references the topic via a data source rather than
# managing it; adopting those existing resources via `import` is a follow-up.

data "aws_sns_topic" "alerts" {
  name = "logjam-alerts"
}

# RDS is a db.t3.micro on 20 GB gp2 with NO storage autoscaling
# (max_allocated_storage unset), so exhausting disk is a hard outage with zero
# cushion. Warn early — 4 GiB free ≈ 80% used — to leave time to extend storage
# or enable autoscaling. FreeStorageSpace is reported in bytes.
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

  alarm_actions = [data.aws_sns_topic.alerts.arn]
  ok_actions    = [data.aws_sns_topic.alerts.arn]
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

  alarm_actions = [data.aws_sns_topic.alerts.arn]
  ok_actions    = [data.aws_sns_topic.alerts.arn]
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

  alarm_actions = [data.aws_sns_topic.alerts.arn]
  ok_actions    = [data.aws_sns_topic.alerts.arn]
}
