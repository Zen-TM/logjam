# CloudWatch log groups for the three ECS workers. 90-day retention
# (previously set by scripts/set-log-retention.sh; now Terraform owns it).
# EB and Container Insights groups are left unmanaged (AWS auto-creates them).

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
