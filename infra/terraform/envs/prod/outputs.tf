# Canonical prod values. These are the single source of truth to cross-check
# against what CI/EB inject at runtime (api/.ebextensions/db-env.config and the
# ECS task-def environment blocks). No secret VALUES are exposed — only the
# Secrets Manager ARN. `terraform output` here is the authoritative reference
# when reconciling env drift.

output "s3_bucket_media" {
  value = module.media.bucket_id
}

output "s3_bucket_topo" {
  value = module.topo_jobs.bucket_id
}

output "s3_bucket_frontend" {
  value = module.frontend.bucket_id
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "ecs_subnets" {
  description = "Comma-joined subnet IDs for ECS_SUBNETS."
  value       = join(",", [data.aws_subnet.worker_a.id, data.aws_subnet.worker_b.id])
}

output "ecs_security_groups" {
  description = "Value for ECS_SECURITY_GROUPS — the dedicated Fargate worker SG (CP-003; was the VPC default SG)."
  value       = aws_security_group.worker.id
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.main.id
}

output "cognito_region" {
  value = "ap-southeast-2"
}

output "topo_cdn_base_url" {
  description = "TOPO_CDN_BASE_URL — the web distribution serves topo tiles under /master/*."
  value       = "https://logjamnsw.com"
}

output "web_cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "api_cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.api.id
}

output "rds_endpoint" {
  value = aws_db_instance.main.endpoint
}

output "rds_db_name" {
  value = aws_db_instance.main.db_name
}

output "db_secret_arn" {
  description = "RDS-managed master credentials secret ARN (DB_SECRET_ID). Value never exposed."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "ecr_api_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "ecr_topo_worker_repository_url" {
  value = aws_ecr_repository.topo_worker.repository_url
}

output "eb_environment_cname" {
  value = aws_elastic_beanstalk_environment.api.cname
}
