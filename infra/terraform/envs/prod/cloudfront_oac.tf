# CloudFront Origin Access Controls — let the web distribution's origins read
# from the private S3 buckets (referenced by id in cloudfront.tf's origin blocks).
# NOTE: a third OAC "logjam-frontend-oac" (E319QVNMQMF9JU) exists but is unused
# by any distribution — left unmanaged; delete it separately if desired.

resource "aws_cloudfront_origin_access_control" "frontend" {
  description                       = "Created by CloudFront"
  name                              = "oac-logjam-frontend-620853681701-ap-southeast-2-an.s-mn1m1580qsz"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "topo_jobs" {
  name                              = "logjam-topo-jobs-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"

  # Live OAC has an empty description; the provider can't represent that (it
  # forces the "Managed by Terraform" default), so ignore it to keep a clean
  # zero-change import rather than make a cosmetic write.
  lifecycle {
    ignore_changes = [description]
  }
}
