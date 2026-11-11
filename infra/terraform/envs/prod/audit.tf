# Operator-trust WORM audit logging.
#
# Turns operator data access from silent/deniable into recorded/tamper-evident.
# Three signals land in ONE S3 bucket with Object Lock in COMPLIANCE mode —
# write-once, undeletable (even by the root account) until retention expires:
#
#   1. CloudTrail MANAGEMENT events  — incl. disk snapshot create/copy/share and
#      the account's other snapshot routes. These are the snapshot-exfiltration
#      teeth: data cannot be pulled out of the DB without leaving a record here.
#   2. CloudTrail S3 DATA events     — object reads/writes on logjam-media +
#      logjam-topo-jobs, object reads on the brain's backup bucket, and EBS
#      direct API calls on disk snapshots (NOT the audit bucket itself — no
#      recursion).
#   3. pgaudit (direct SQL)          — shipped off the brain's Postgres to the
#      same WORM bucket via CloudWatch Logs -> Kinesis Firehose (brain_logs.tf;
#      infra/brain/postgres/postgresql.conf turns pgaudit on). Operator
#      sessions log reads+writes+ddl; the app role (logjam_app) drops read
#      logging per-role for cost (its reads carry no operator-access signal),
#      with log_connections capturing every connect so an operator using the app
#      role to dodge read-logging is still recorded. See the bootstrap SQL.
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
      local.deny_insecure_transport["audit"],
    ]
  })
}

# ── CloudTrail: management, S3 object and EBS direct API events ─────────────

locals {
  # BEGIN audit-selectors (a scratch trail copies these lines between the
  # markers verbatim to prove them on real AWS, so keep them self-contained)
  audit_event_selectors = [
    # Management events (read + write): ec2:CreateSnapshot, ssm:StartSession,
    # ssm:SendCommand and ecs:RunTask, and any database service's snapshot
    # calls (RDS CreateDBSnapshot / CopyDBSnapshot / ModifyDBSnapshotAttribute /
    # StartExportTask) should one be made again. The snapshot-exfiltration
    # record.
    {
      name = "management events, read and write"
      fields = [
        { field = "eventCategory", equals = ["Management"] },
      ]
    },
    # S3 object events on the user-data buckets. The audit bucket is
    # deliberately excluded (a self-referential event loop + cost), and so is
    # the brain's signals bucket (no user data).
    {
      name = "object reads and writes in the media and topo buckets"
      fields = [
        { field = "eventCategory", equals = ["Data"] },
        { field = "resources.type", equals = ["AWS::S3::Object"] },
        { field = "resources.ARN", starts_with = ["arn:aws:s3:::${local.media_bucket}/", "arn:aws:s3:::${local.topo_jobs_bucket}/"] },
      ]
    },
    # Reads only of the brain's backups, which are the whole database as plain
    # objects: without this, a GetObject of them leaves no record. Writes are
    # left out: the brain writes a WAL object every minute and Object Lock
    # already stops an overwrite or a delete.
    {
      name = "object reads in the brain's backup bucket"
      fields = [
        { field = "eventCategory", equals = ["Data"] },
        { field = "resources.type", equals = ["AWS::S3::Object"] },
        { field = "readOnly", equals = ["true"] },
        { field = "resources.ARN", starts_with = ["arn:aws:s3:::${local.brain_backups_bucket}/"] },
      ]
    },
    # EBS direct APIs read a disk snapshot block by block (the brain's disk
    # holds the database); these are data events, not management events.
    {
      name = "EBS direct API calls on snapshots, read and write"
      fields = [
        { field = "eventCategory", equals = ["Data"] },
        { field = "resources.type", equals = ["AWS::EC2::Snapshot"] },
      ]
    },
  ]
  # END audit-selectors
}

resource "aws_cloudtrail" "audit" {
  name                          = local.trail_name
  s3_bucket_name                = aws_s3_bucket.audit.id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true # digest files: tamper-evidence on top of Object Lock

  # BEGIN audit-trail-selector-blocks
  dynamic "advanced_event_selector" {
    for_each = local.audit_event_selectors
    content {
      name = advanced_event_selector.value.name
      dynamic "field_selector" {
        for_each = advanced_event_selector.value.fields
        content {
          field       = field_selector.value.field
          equals      = try(field_selector.value.equals, null)
          starts_with = try(field_selector.value.starts_with, null)
        }
      }
    }
  }
  # END audit-trail-selector-blocks

  depends_on = [aws_s3_bucket_policy.audit]
}

# ── pgaudit (CloudWatch Logs) -> Firehose -> WORM bucket ────────────────────
#
# pgaudit writes to the brain's postgres CloudWatch log group, which has no
# Object Lock and is operator-deletable. To make direct-SQL audit tamper-evident
# it must reach the WORM bucket: a subscription filter (brain_logs.tf) streams
# the log group to Firehose, which lands it in the Object-Lock bucket (objects
# inherit the bucket's default COMPLIANCE retention).

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

# ── Outputs ─────────────────────────────────────────────────────────────────

output "audit_bucket" {
  description = "WORM (Object Lock) bucket holding CloudTrail + pgaudit logs."
  value       = aws_s3_bucket.audit.id
}

output "audit_trail_arn" {
  description = "CloudTrail trail ARN for operator-access auditing."
  value       = aws_cloudtrail.audit.arn
}
