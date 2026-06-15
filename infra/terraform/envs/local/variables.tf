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
