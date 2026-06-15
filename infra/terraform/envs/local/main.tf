# Two LocalStack S3 buckets, replacing scripts/seed-localstack.sh. They need a
# CORS rule: media/topo uploads are browser-direct presigned PUTs from the Vite
# dev origin, and the browser enforces CORS against the bucket's config (served
# by LocalStack) — without it the upload is blocked. Mirrors the prod buckets'
# CORS but scoped to the localhost dev origins.

locals {
  dev_cors = [{
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
    expose_headers  = ["ETag", "Content-Range", "Accept-Ranges", "Content-Length"]
    max_age_seconds = 3000
  }]
}

module "media" {
  source      = "../../modules/storage"
  bucket_name = "logjam-media-local"
  cors_rules  = local.dev_cors
}

module "topo" {
  source      = "../../modules/storage"
  bucket_name = "logjam-topo-local"
  cors_rules  = local.dev_cors
}
