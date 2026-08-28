variable "bucket_name" {
  type        = string
  description = "S3 bucket name."
}

variable "versioning_enabled" {
  type        = bool
  default     = false
  description = "Enable bucket versioning. Prod app buckets are unversioned; only the tfstate bucket versions (managed in bootstrap, not this module)."
}

variable "sse_algorithm" {
  type        = string
  default     = null
  description = "Server-side encryption algorithm (e.g. \"AES256\"). null = do not manage an SSE config (LocalStack dev)."
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
  description = "Public-access-block settings. null = do not manage one (LocalStack dev). Prod buckets are all-true (media/frontend/topo-jobs, CP-004) — the CloudFront OAC bucket policy grants access without needing any of the four PAB flags relaxed."
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
  description = "CORS rules. Empty = no CORS config managed (LocalStack does not enforce CORS)."
}

variable "lifecycle_rules" {
  type = list(object({
    id              = string
    prefix          = string
    expiration_days = number
  }))
  default     = []
  description = "Object-expiry lifecycle rules. Empty = no lifecycle config managed."
}
