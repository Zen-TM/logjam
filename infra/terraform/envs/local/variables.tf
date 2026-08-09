# Cognito identifiers used only when running local dev against real Cognito
# (`make dev-snapshot`). These are PUBLIC client identifiers shipped in the SPA
# bundle, not secrets. Defaults are the live Logjam pool/client.
# TODO (M6): source these from the prod root via terraform_remote_state instead
# of duplicating the literals, to keep a single source of truth.
variable "cognito_user_pool_id" {
  type    = string
  default = "ap-southeast-2_x5zPhJXMk"
}

variable "cognito_client_id" {
  type    = string
  default = "545ofbb8l9d1sl6ggbmk6oonn9"
}

# Resend transactional email — LOCAL TESTING ONLY. Blank by default → the
# workers' email send is a no-op (no real emails from dev). To actually send
# from local dev, set BOTH via env (commit-safe — nothing lands on disk):
#
#   TF_VAR_resend_api_key=re_xxx \
#   TF_VAR_email_from=noreply@notifications.logjamnsw.com \
#   make dev
#
# email_from must be a Resend-verified sender; the noreply@local default is
# rejected by Resend, so leaving the key set but email_from at default still
# no-ops safely (Resend would reject) — set both to truly send.
variable "resend_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "email_from" {
  type    = string
  default = "noreply@local"
}

# Protomaps basemap archive the region-clip endpoint extracts offline map
# regions from (POST /basemap/region-clip runs `pmtiles extract` against it).
#
# EMPTY BY DEFAULT, and the endpoint answers 503 "Region clips are not
# available" when it is — which is correct and was for a long time mistaken for
# a bug in the mobile download. The archive is ~740 MB and machine-local, so it
# is not something a checkout can carry: set this per machine in a gitignored
# `*.auto.tfvars` beside this file, e.g.
#
#   protomaps_archive_uri = "/home/you/logjam-basemap/protomaps-nsw.pmtiles"
#
# Fetch it with `aws s3 cp s3://logjam-topo-jobs/master/basemap/protomaps-nsw.pmtiles .`
# (profile logjam), and put the `pmtiles` binary on PATH — the API shells out to
# it, and its absence is the OTHER cause of that same 503. Pin the same release
# api/Dockerfile does.
variable "protomaps_archive_uri" {
  type    = string
  default = ""
}
