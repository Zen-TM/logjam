locals {
  brain_backups_bucket = "logjam-brain-backups-${local.account_id}"
  brain_signals_bucket = "logjam-brain-signals-${local.account_id}"
}

# ── Backups: the pgBackRest repository ──────────────────────────────────────
#
# Object Lock in COMPLIANCE mode, as the audit bucket: for 7 days no one, root
# included, can delete or overwrite what the brain wrote. The brain's role can
# read and add objects (brain_iam.tf), so a compromised API could read
# backups; the lock is what stops it destroying them.
#
# NEVER add an expiration of current versions. pgBackRest expires backups by
# count, and an age rule would delete the only backup after a run of failed
# nights. Only noncurrent versions (what pgBackRest's own deletes leave
# behind), orphaned delete markers and unfinished uploads are cleaned up here.
# Guard: tests/guards.tftest.hcl (brain_backups_are_locked_and_never_expire).
resource "aws_s3_bucket" "brain_backups" {
  bucket              = local.brain_backups_bucket
  object_lock_enabled = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "brain_backups" {
  bucket = aws_s3_bucket.brain_backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "brain_backups" {
  bucket = aws_s3_bucket.brain_backups.id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = 7
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "brain_backups" {
  bucket = aws_s3_bucket.brain_backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "brain_backups" {
  bucket                  = aws_s3_bucket.brain_backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "brain_backups" {
  bucket = aws_s3_bucket.brain_backups.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [local.deny_insecure_transport["brain_backups"]]
  })
}

resource "aws_s3_bucket_lifecycle_configuration" "brain_backups" {
  bucket = aws_s3_bucket.brain_backups.id

  rule {
    id     = "clean-up-noncurrent-versions"
    status = "Enabled"
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 1
    }
    expiration {
      expired_object_delete_marker = true
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.brain_backups]
}

# ── Signals: what the brain and CI tell each other ──────────────────────────
#
# release.json (CI writes), serving (Terraform writes), status.json (the brain
# writes), drill.json (the restore drill writes). None of it is user data, so
# this is the one new bucket CI may read objects from (the exceptions of
# local.ci_readonly_privacy_deny): never put anything else in it.
resource "aws_s3_bucket" "brain_signals" {
  bucket = local.brain_signals_bucket
}

resource "aws_s3_bucket_versioning" "brain_signals" {
  bucket = aws_s3_bucket.brain_signals.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "brain_signals" {
  bucket = aws_s3_bucket.brain_signals.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "brain_signals" {
  bucket                  = aws_s3_bucket.brain_signals.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "brain_signals" {
  bucket = aws_s3_bucket.brain_signals.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [local.deny_insecure_transport["brain_signals"]]
  })
}

# The switch the brain reads before it starts the API. A missing object also
# means off, so the brain never serves by accident.
resource "aws_s3_object" "brain_serving" {
  bucket       = aws_s3_bucket.brain_signals.id
  key          = "serving"
  content      = var.brain_serving ? "on" : "off"
  content_type = "text/plain"
}
