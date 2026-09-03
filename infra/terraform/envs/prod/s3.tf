# Prod S3 buckets, via the same storage module the local root uses. CloudFront
# OAC bucket policies (topo-jobs master/*, frontend /*) are NOT managed here —
# they reference the CloudFront distribution and are owned by the CDN config in
# M5 once that distribution is a Terraform resource. Leaving them undeclared
# means Terraform does not touch the live policies.

# S3 server access logs for the two buckets users can pull bytes out of. This
# is the ONLY source of real egress volume: the API hands out presigned GET
# URLs far more often than they are fetched (lib/mediaPresign.ts mints one per
# photo on every canyon read), so minting cannot be used as a proxy for
# downloading. The per-user monthly egress meter reads these.
#
# No logging config on this bucket itself — delivery writes here would be
# logged here, which does not terminate.
#
# 30-day expiry: the meter only ever reads the current and previous month's
# partial data, and raw access logs are high-volume and low-value once summed.
module "access_logs" {
  source        = "../../modules/storage"
  bucket_name   = "logjam-access-logs-620853681701"
  sse_algorithm = "AES256"

  public_access_block = {
    block_public_acls       = true
    block_public_policy     = true
    ignore_public_acls      = true
    restrict_public_buckets = true
  }

  lifecycle_rules = [{
    id              = "expire-access-logs"
    prefix          = ""
    expiration_days = 30
  }]
}

# User media uploads. Fully private (presigned URLs only); browser-direct
# uploads need the CORS rule.
module "media" {
  source        = "../../modules/storage"
  bucket_name   = "logjam-media"
  sse_algorithm = "AES256"

  log_target = {
    bucket = module.access_logs.bucket_id
    prefix = "media/"
  }

  public_access_block = {
    block_public_acls       = true
    block_public_policy     = true
    ignore_public_acls      = true
    restrict_public_buckets = true
  }

  cors_rules = [{
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = ["https://logjamnsw.com", "https://www.logjamnsw.com"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }]
}

# Topo job inputs/outputs + CDN-served master tiles. All four PAB flags true
# (CP-004): the CloudFront OAC bucket policy grants read to the
# cloudfront.amazonaws.com SERVICE principal under an AWS:SourceArn condition —
# S3 does not classify that as "public", so block_public_policy /
# restrict_public_buckets do not affect OAC tile serving (verify with a
# CloudFront tile fetch after apply).
module "topo_jobs" {
  source                 = "../../modules/storage"
  bucket_name            = "logjam-topo-jobs"
  sse_algorithm          = "AES256"
  sse_bucket_key_enabled = true

  log_target = {
    bucket = module.access_logs.bucket_id
    prefix = "topo-jobs/"
  }

  public_access_block = {
    block_public_acls       = true
    block_public_policy     = true
    ignore_public_acls      = true
    restrict_public_buckets = true
  }

  cors_rules = [{
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = ["http://localhost:5173", "https://logjamnsw.com", "https://www.logjamnsw.com"]
    expose_headers  = ["ETag", "Content-Range", "Accept-Ranges", "Content-Length"]
  }]

  lifecycle_rules = [{
    id              = "expire-exports"
    prefix          = "exports/"
    expiration_days = 7
  }]
}

# Frontend SPA bundle, served via CloudFront OAC. Private bucket; the OAC
# bucket policy (managed in M5) is the only read grant.
module "frontend" {
  source                 = "../../modules/storage"
  bucket_name            = "logjam-frontend-620853681701-ap-southeast-2-an"
  sse_algorithm          = "AES256"
  sse_bucket_key_enabled = true

  public_access_block = {
    block_public_acls       = true
    block_public_policy     = true
    ignore_public_acls      = true
    restrict_public_buckets = true
  }
}

# Account-level S3 Block Public Access backstop (CP-003). Per-bucket PAB above
# only covers buckets Terraform manages; this catches every bucket in the
# account — including the AWS-managed Elastic Beanstalk deploy bucket
# (elasticbeanstalk-ap-southeast-2-620853681701, created without PAB by default)
# and any future/orphan bucket. All logjam buckets are already private (OAC
# service-principal policies, not Principal:"*"), so this adds no access
# regression — it is a defence-in-depth floor against an accidental public ACL
# or policy.
resource "aws_s3_account_public_access_block" "account" {
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
