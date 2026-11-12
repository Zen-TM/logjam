variable "bucket_name" {
  type        = string
  description = "S3 bucket name."
}

variable "versioning_enabled" {
  type        = bool
  default     = false
  description = "Enable bucket versioning. Prod's media bucket versions (a delete is undoable for a short window, see s3.tf); the other app buckets do not."
}

variable "sse_algorithm" {
  type        = string
  default     = null
  description = "Server-side encryption algorithm (e.g. \"AES256\"). null = do not manage an SSE config (MiniStack dev)."
}

variable "sse_bucket_key_enabled" {
  type        = bool
  default     = false
  description = "S3 Bucket Key for SSE. Only meaningful when sse_algorithm is set."
}

variable "public_access_block" {
  type = object({
    block_public_acls       = bool
    block_public_policy     = bool
    ignore_public_acls      = bool
    restrict_public_buckets = bool
  })
  default     = null
  description = "Public-access-block settings. null = do not manage one (MiniStack dev). Prod buckets are all-true (media/frontend/topo-jobs) — the CloudFront OAC bucket policy grants access without needing any of the four PAB flags relaxed."
}

variable "cors_rules" {
  type = list(object({
    allowed_headers = optional(list(string), [])
    allowed_methods = list(string)
    allowed_origins = list(string)
    expose_headers  = optional(list(string), [])
    max_age_seconds = optional(number)
  }))
  default     = []
  description = "CORS rules. Empty = no CORS config managed (MiniStack does not enforce CORS)."
}

variable "lifecycle_rules" {
  type = list(object({
    id                              = string
    prefix                          = string
    expiration_days                 = optional(number)
    noncurrent_expiration_days      = optional(number)
    expire_delete_markers           = optional(bool, false)
    abort_incomplete_multipart_days = optional(number)
  }))
  default     = []
  description = "Lifecycle rules: expire objects, expire noncurrent versions (versioned buckets), remove delete markers left with no versions behind them, or abort multipart uploads left incomplete. Empty = no lifecycle config managed."
}

variable "log_target" {
  type = object({
    bucket = string
    prefix = string
  })
  default     = null
  description = "S3 server access logging destination. null = do not manage a logging config. The target bucket must live in the same region and grant s3:PutObject to logging.s3.amazonaws.com; never point a bucket at itself (the delivery writes are themselves logged, which never terminates)."
}
