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
# the task def sets awslogs-create-group=false and relies on this group
# existing. Migrate logs carry only migration names, no user data.
resource "aws_cloudwatch_log_group" "api_migrate" {
  name              = "/ecs/logjam-api-migrate"
  retention_in_days = 90
}
