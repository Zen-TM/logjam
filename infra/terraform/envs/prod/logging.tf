# How long every operational log is kept: one figure for all of them, which
# privacy.html states once. Operational logs exist to debug the last incident,
# and two weeks covers an incident noticed after a week away.
#
# The audit trail is the one exception: it is kept for accountability rather
# than debugging (var.audit_log_retention_days, audit.tf).
#
# Everything that must agree with this local: every retention_in_days in this
# directory, the access-logs lifecycle rule (s3.tf), privacy.html's Retention
# section and delete-account.html's list of what is kept. Guard:
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

resource "aws_cloudwatch_log_group" "place_registry" {
  name              = "/ecs/logjam-place-registry"
  retention_in_days = local.operational_log_retention_days
}

resource "aws_cloudwatch_log_group" "gauges" {
  name              = "/ecs/logjam-gauges"
  retention_in_days = local.operational_log_retention_days
}

resource "aws_cloudwatch_log_group" "fire_history" {
  name              = "/ecs/logjam-fire-history"
  retention_in_days = local.operational_log_retention_days
}

resource "aws_cloudwatch_log_group" "coverage" {
  name              = "/ecs/logjam-coverage"
  retention_in_days = local.operational_log_retention_days
}

resource "aws_cloudwatch_log_group" "api_script" {
  name              = "/ecs/logjam-api-script"
  retention_in_days = local.operational_log_retention_days
}

# Pre-deploy migrate one-shot. Pre-created here because
# ecsTaskExecutionRole has no logs:CreateLogGroup (standard task-exec policy) —
# the task def OMITS awslogs-create-group entirely (ECS rejects "false"; see
# ecs.tf:217) and relies on this group already existing. Migrate logs carry
# only migration names, no user data.
resource "aws_cloudwatch_log_group" "api_migrate" {
  name              = "/ecs/logjam-api-migrate"
  retention_in_days = local.operational_log_retention_days
}

# Logjam GPS versions in the field, kept as a metric because the log group
# keeps only 14 days (docs/operations/queries.md reads it). One dimension, the
# version: every distinct string the API accepts (CLIENT_HEADER_REGEX in
# api/src/routes/sync.ts, signed-in requests only) is one metric at about
# $0.30 a month while it keeps syncing, and CloudWatch disables a filter that
# emits too many distinct values, which bounds anyone sending made-up versions.
resource "aws_cloudwatch_log_metric_filter" "sync_client" {
  name           = "logjam-sync-client"
  log_group_name = local.api_log_group
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
