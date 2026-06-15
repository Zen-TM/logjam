# S3 bucket policies granting the web CloudFront distribution (OAC) read access:
# frontend bucket (whole SPA) and topo-jobs master/* tiles. These reference the
# distribution by ARN, so they're managed here now that the distribution is a
# Terraform resource.

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
    }]
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
    }]
  })
}
