# CloudWatch log groups for the three ECS workers. 90-day retention
# (previously set by scripts/set-log-retention.sh; now Terraform owns it).
#
# The EB API log groups (/aws/elasticbeanstalk/logjam-api-prod/*) are NOT managed
# here — their names are dynamic and AWS auto-creates them. Their 7-day retention
# is enforced EB-natively via RetentionInDays in api/.ebextensions/cloudwatch-logs.config
# (recreation-safe, CI-applied on deploy), backing the privacy.html retention claim
# (PRIV-001). Container Insights groups remain unmanaged (AWS default).

resource "aws_cloudwatch_log_group" "topo_worker" {
  name              = "/ecs/logjam-topo-worker"
  retention_in_days = 90
}

resource "aws_cloudwatch_log_group" "topo_export_worker" {
  name              = "/ecs/logjam-topo-export-worker"
  retention_in_days = 90
}

resource "aws_cloudwatch_log_group" "geo_pdf_worker" {
  name              = "/ecs/logjam-geo-pdf-worker"
  retention_in_days = 90
}

# Pre-deploy migrate one-shot (ARCH-001 half B). Pre-created here because
# ecsTaskExecutionRole has no logs:CreateLogGroup (standard task-exec policy) —
# the task def OMITS awslogs-create-group entirely (ECS rejects "false"; see
# ecs.tf:217) and relies on this group already existing. Migrate logs carry
# only migration names, no user data.
resource "aws_cloudwatch_log_group" "api_migrate" {
  name              = "/ecs/logjam-api-migrate"
  retention_in_days = 90
}

# Logjam GPS versions in the field, kept as a metric because the log group
# keeps only 7 days (docs/operations/queries.md reads it). One dimension, the
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
