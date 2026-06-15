output "bucket_id" {
  value       = aws_s3_bucket.this.id
  description = "Bucket name."
}

output "bucket_arn" {
  value       = aws_s3_bucket.this.arn
  description = "Bucket ARN."
}
