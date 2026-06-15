# Two LocalStack S3 buckets, replacing scripts/seed-localstack.sh. Plain
# buckets — no SSE/PAB/CORS/lifecycle: LocalStack does not enforce CORS and the
# old seed script created bare buckets, so we keep dev behaviour identical.
module "media" {
  source      = "../../modules/storage"
  bucket_name = "logjam-media-local"
  # No PAB/SSE/CORS/lifecycle — LocalStack does not enforce them and the old
  # seed script made bare buckets, so dev behaviour stays identical.
}

module "topo" {
  source      = "../../modules/storage"
  bucket_name = "logjam-topo-local"
}
