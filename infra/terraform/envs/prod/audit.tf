# Operator-trust WORM audit logging (operator-trust-plan Part C).
#
# Turns operator data access from silent/deniable into recorded/tamper-evident.
# Three signals land in ONE S3 bucket with Object Lock in COMPLIANCE mode —
# write-once, undeletable (even by the root account) until retention expires:
#
#   1. CloudTrail MANAGEMENT events  — incl. RDS snapshot create/copy/share/
#      restore/export. These are the snapshot-exfiltration teeth: data cannot be
#      pulled out of the DB without leaving a record here.
#   2. CloudTrail S3 DATA events     — object reads/writes on logjam-media +
#      logjam-topo-jobs (NOT the audit bucket itself — no recursion).
#   3. pgaudit (direct SQL)          — shipped off the RDS instance to the same
#      WORM bucket via CloudWatch Logs -> Kinesis Firehose (see rds.tf for the
#      parameter group that turns pgaudit on). Operator/master sessions log
#      reads+writes+ddl; the app role (logjam_app) drops read logging per-role
#      for cost (its reads carry no operator-access signal), with
#      log_connections capturing every connect so an operator using the app role
#      to dodge read-logging is still recorded. See rds.tf + bootstrap SQL.
#
# Single-account caveat (documented in docs/DATA-ACCESS-POLICY.md): Object Lock
# stops deletion of written entries even by root, but production root can still
# stop/reconfigure the trail going forward. A stronger design ships logs to a
# separate AWS account production root cannot administer; this sink is structured
# so relocating it later is a config change.

locals {
  account_id = "620853681701"
  region     = "ap-southeast-2"
  trail_name = "logjam-audit"
  # ARN built as a literal (not aws_cloudtrail.audit.arn) to break the
  # bucket-policy <-> trail dependency cycle: the trail depends_on the bucket
  # policy, so the policy cannot reference the trail resource.
  trail_arn        = "arn:aws:cloudtrail:${local.region}:${local.account_id}:trail/${local.trail_name}"
  # Derived from the instance, never a literal: RDS names this group after the
  # identifier, so the 2026-06-23 logjam-db -> logjam-db-enc migration left a
  # hardcoded name pointing at a dead group and pgaudit delivery was silently
  # dead for two months (INF-001). Interpolating makes a rename impossible to
  # desync; the IncomingBytes alarm in monitoring.tf catches it if it ever does.
  rds_log_group    = "/aws/rds/instance/${aws_db_instance.main.identifier}/postgresql"
  media_bucket     = "logjam-media"
  topo_jobs_bucket = "logjam-topo-jobs"
}

variable "audit_log_retention_days" {
  description = "Object Lock COMPLIANCE retention for audit logs (days). Undeletable for this whole window — even by root — so it also bounds storage cost."
  type        = number
  default     = 365
}

# ── WORM sink bucket ────────────────────────────────────────────────────────

# object_lock_enabled MUST be set at creation; it cannot be turned on later.
resource "aws_s3_bucket" "audit" {
  bucket              = "logjam-audit-${local.account_id}"
  object_lock_enabled = true
}

# Object Lock requires versioning.
resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.audit_log_retention_days
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudTrail delivery permission (standard trail bucket policy). Firehose writes
# via its own IAM role, so it does not need a bucket-policy grant.
resource "aws_s3_bucket_policy" "audit" {
  bucket = aws_s3_bucket.audit.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AWSCloudTrailAclCheck"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:GetBucketAcl"
        Resource  = aws_s3_bucket.audit.arn
        Condition = { StringEquals = { "aws:SourceArn" = local.trail_arn } }
      },
      {
        Sid       = "AWSCloudTrailWrite"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.audit.arn}/AWSLogs/${local.account_id}/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl"  = "bucket-owner-full-control"
            "aws:SourceArn" = local.trail_arn
          }
        }
      },
    ]
  })
}

# ── CloudTrail: management + S3 data events ─────────────────────────────────

resource "aws_cloudtrail" "audit" {
  name                          = local.trail_name
  s3_bucket_name                = aws_s3_bucket.audit.id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true # digest files: tamper-evidence on top of Object Lock

  # Management events (read + write): includes RDS CreateDBSnapshot /
  # CopyDBSnapshot / ModifyDBSnapshotAttribute / RestoreDBInstance* /
  # StartExportTask — the snapshot-exfiltration record.
  event_selector {
    read_write_type           = "All"
    include_management_events = true
  }

  # S3 object-level data events on the user-data buckets only. The audit bucket
  # is deliberately excluded to avoid a self-referential event loop + cost.
  event_selector {
    read_write_type           = "All"
    include_management_events = false

    data_resource {
      type = "AWS::S3::Object"
      values = [
        "arn:aws:s3:::${local.media_bucket}/",
        "arn:aws:s3:::${local.topo_jobs_bucket}/",
      ]
    }
  }

  depends_on = [aws_s3_bucket_policy.audit]
}

# ── pgaudit (CloudWatch Logs) -> Firehose -> WORM bucket ────────────────────
#
# pgaudit writes to the RDS postgresql CloudWatch log group, which has no Object
# Lock and is operator-deletable. To make direct-SQL audit tamper-evident it
# must reach the WORM bucket: a subscription filter streams the log group to
# Firehose, which lands it in the Object-Lock bucket (objects inherit the
# bucket's default COMPLIANCE retention).

# Firehose -> S3 delivery role.
resource "aws_iam_role" "firehose_pgaudit" {
  name = "logjam-firehose-pgaudit-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "firehose.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "firehose_pgaudit_s3" {
  name = "logjam-firehose-pgaudit-s3"
  role = aws_iam_role.firehose_pgaudit.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:AbortMultipartUpload",
        "s3:GetBucketLocation",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads",
        "s3:PutObject",
      ]
      Resource = [
        aws_s3_bucket.audit.arn,
        "${aws_s3_bucket.audit.arn}/*",
      ]
    }]
  })
}

resource "aws_kinesis_firehose_delivery_stream" "pgaudit" {
  name        = "logjam-pgaudit-to-worm"
  destination = "extended_s3"

  extended_s3_configuration {
    role_arn            = aws_iam_role.firehose_pgaudit.arn
    bucket_arn          = aws_s3_bucket.audit.arn
    prefix              = "pgaudit/"
    error_output_prefix = "pgaudit-errors/"
    buffering_size      = 5
    buffering_interval  = 300
    compression_format  = "GZIP"
  }
}

# CloudWatch Logs -> Firehose delivery role.
resource "aws_iam_role" "cwl_to_firehose" {
  name = "logjam-cwl-to-firehose-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "logs.${local.region}.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "cwl_to_firehose" {
  name = "logjam-cwl-to-firehose"
  role = aws_iam_role.cwl_to_firehose.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["firehose:PutRecord", "firehose:PutRecordBatch"]
      Resource = aws_kinesis_firehose_delivery_stream.pgaudit.arn
    }]
  })
}

# The RDS postgresql log group is created by RDS itself once
# enabled_cloudwatch_logs_exports = ["postgresql"] is applied (see rds.tf) — it
# is intentionally NOT a Terraform-managed resource (same convention as the EB /
# Container Insights groups in logging.tf). This filter therefore depends on the
# instance modify having happened; on a clean apply the group must already exist.
resource "aws_cloudwatch_log_subscription_filter" "pgaudit_to_firehose" {
  name            = "logjam-pgaudit-to-worm"
  log_group_name  = local.rds_log_group
  filter_pattern  = "" # all events
  destination_arn = aws_kinesis_firehose_delivery_stream.pgaudit.arn
  role_arn        = aws_iam_role.cwl_to_firehose.arn

  depends_on = [aws_db_instance.main]
}

# ── Outputs ─────────────────────────────────────────────────────────────────

output "audit_bucket" {
  description = "WORM (Object Lock) bucket holding CloudTrail + pgaudit logs."
  value       = aws_s3_bucket.audit.id
}

output "audit_trail_arn" {
  description = "CloudTrail trail ARN for operator-access auditing."
  value       = aws_cloudtrail.audit.arn
}
