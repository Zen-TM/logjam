provider "aws" {
  region = "ap-southeast-2"

  # Hard guard: refuse to run against any account but Logjam prod.
  allowed_account_ids = ["620853681701"]
}

# ── Terraform remote-state bucket ─────────────────────────────────────────────
# Holds the state for every other Terraform root (prod). Account-suffixed for
# S3 global uniqueness. Versioned so a clobbered state can be recovered.
resource "aws_s3_bucket" "tfstate" {
  bucket = "logjam-tfstate-620853681701"

  # State loss = lose Terraform's map of code→real resources (recoverable by
  # re-import, but painful). Never let an apply delete this bucket.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "state_bucket" {
  value       = aws_s3_bucket.tfstate.id
  description = "Name of the Terraform remote-state bucket. Used as the backend bucket in envs/prod/backend.tf."
}
