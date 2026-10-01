# How long every operational log is kept: one figure for all of them, which
# privacy.html states once. Operational logs exist to debug the last incident,
# and two weeks covers an incident noticed after a week away. Before this each
# group carried its own number (7, 14, 30, 90, and none at all for the RDS log
# export), none of them for a reason the others lacked.
#
# The audit trail is the one exception: it is kept for accountability rather
# than debugging (var.audit_log_retention_days, audit.tf).
#
# Everything that must agree with this local: every retention_in_days in this
# directory, the access-logs lifecycle rule (s3.tf), RetentionInDays in
# api/.ebextensions/cloudwatch-logs.config (EB-owned groups Terraform cannot
# name), and privacy.html's Retention section. Guard:
# api/src/logRetention.unit.test.ts.
#
# Container Insights groups remain unmanaged (AWS default, 1 day).
locals {
  operational_log_retention_days = 14
}

resource "aws_cloudwatch_log_group" "topo_worker" {
  name              = "/ecs/logjam-topo-worker"
  retention_in_days = local.operational_log_retention_days
}

resource "aws_cloudwatch_log_group" "topo_export_worker" {
  name              = "/ecs/logjam-topo-export-worker"
  retention_in_days = local.operational_log_retention_days
}

resource "aws_cloudwatch_log_group" "geo_pdf_worker" {
  name              = "/ecs/logjam-geo-pdf-worker"
  retention_in_days = local.operational_log_retention_days
}

# Pre-deploy migrate one-shot (ARCH-001 half B). Pre-created here because
# ecsTaskExecutionRole has no logs:CreateLogGroup (standard task-exec policy) —
# the task def OMITS awslogs-create-group entirely (ECS rejects "false"; see
# ecs.tf:217) and relies on this group already existing. Migrate logs carry
# only migration names, no user data.
resource "aws_cloudwatch_log_group" "api_migrate" {
  name              = "/ecs/logjam-api-migrate"
  retention_in_days = local.operational_log_retention_days
}

# The RDS log export (pgaudit and connection lines; see audit.tf and rds.tf).
# RDS creates the group when the export starts, so Terraform never named it and
# nothing here bounded it (the AWS default keeps events forever). The subscription filter in audit.tf copies each line
# to the audit bucket within minutes, and the pgaudit_delivery_stalled alarm
# fires after 24 h without a delivery, so this copy only has to outlive a
# stalled pipeline long enough to be noticed.
import {
  to = aws_cloudwatch_log_group.rds_postgresql
  id = "/aws/rds/instance/logjam-db-enc/postgresql"
}

resource "aws_cloudwatch_log_group" "rds_postgresql" {
  name              = local.rds_log_group
  retention_in_days = local.operational_log_retention_days
}

# Logjam GPS versions in the field, kept as a metric because the log group
# keeps only 14 days (docs/operations/queries.md reads it). One dimension, the
# version: every distinct string the API accepted (CLIENT_HEADER_REGEX in
# api/src/routes/sync.ts, signed-in requests only) is one metric at about
# $0.30 a month while it keeps syncing, and CloudWatch disables a filter that
# emits too many distinct values, which bounds anyone sending made-up versions.
resource "aws_cloudwatch_log_metric_filter" "sync_client" {
  name           = "logjam-sync-client"
  log_group_name = local.eb_api_stdout_log_group
  pattern        = "{ $.msg = \"sync_client\" && $.client_platform = \"mobile\" }"

  metric_transformation {
    namespace = "Logjam/Clients"
    name      = "SyncRequests"
    value     = "1"
    dimensions = {
      client_version = "$.client_version"
    }
  }
}
