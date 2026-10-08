# S3 bucket policies granting the web CloudFront distribution (OAC) read access:
# frontend bucket (whole SPA) and topo-jobs master/* tiles. These reference the
# distribution by ARN, so they're managed here now that the distribution is a
# Terraform resource.

# Every bucket refuses plain-HTTP requests. A bucket policy is one document per
# bucket, so each policy below (and audit's, in audit.tf) appends this statement.
locals {
  deny_insecure_transport = {
    for name, arn in {
      frontend    = module.frontend.bucket_arn
      topo_jobs   = module.topo_jobs.bucket_arn
      access_logs = module.access_logs.bucket_arn
      media       = module.media.bucket_arn
      audit       = aws_s3_bucket.audit.arn
      } : name => {
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [arn, "${arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = module.frontend.bucket_id
  policy = jsonencode({
    Version = "2008-10-17"
    Id      = "PolicyForCloudFrontPrivateContent"
    Statement = [{
      Sid       = "AllowCloudFrontServicePrincipal"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${module.frontend.bucket_arn}/*"
      Condition = {
        ArnLike = {
          "AWS:SourceArn" = aws_cloudfront_distribution.web.arn
        }
      }
    }, local.deny_insecure_transport["frontend"]]
  })
}

resource "aws_s3_bucket_policy" "topo_jobs" {
  bucket = module.topo_jobs.bucket_id
  policy = jsonencode({
    Version = "2008-10-17"
    Id      = "PolicyForCloudFrontPrivateContent"
    Statement = [{
      Sid       = "AllowCloudFrontOACMasterTiles"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${module.topo_jobs.bucket_arn}/master/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.web.arn
        }
      }
    }, local.deny_insecure_transport["topo_jobs"]]
  })
}

# S3 log delivery writes as a service principal, not as the account, so the
# default "owner can do anything" posture does not cover it. Without this
# statement `aws_s3_bucket_logging` applies cleanly and then silently delivers
# nothing — the failure mode is an empty bucket, not an error.
#
# The SourceAccount + SourceArn conditions are the confused-deputy guard: they
# stop another account from naming this bucket as ITS log destination.
resource "aws_s3_bucket_policy" "access_logs" {
  bucket = module.access_logs.bucket_id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowS3ServerAccessLogDelivery"
      Effect    = "Allow"
      Principal = { Service = "logging.s3.amazonaws.com" }
      Action    = "s3:PutObject"
      Resource  = "${module.access_logs.bucket_arn}/*"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = "620853681701"
        }
        ArnLike = {
          "aws:SourceArn" = [
            module.media.bucket_arn,
            module.topo_jobs.bucket_arn,
          ]
        }
      }
    }, local.deny_insecure_transport["access_logs"]]
  })
}

resource "aws_s3_bucket_policy" "media" {
  bucket = module.media.bucket_id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [local.deny_insecure_transport["media"]]
  })
}
