# Token-verification config used only when running local dev against real
# Cognito (`make dev-snapshot`). Public identifiers (the issuer URL and the
# client ids shipped in the SPA bundle), not secrets. Defaults are the live
# Logjam pool/client; the audience is a comma-separated list.
# TODO: source these from the prod root via terraform_remote_state instead
# of duplicating the literals, to keep a single source of truth.
variable "oidc_issuer" {
  type    = string
  default = "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_x5zPhJXMk"
}

variable "oidc_audience" {
  type    = string
  default = "545ofbb8l9d1sl6ggbmk6oonn9"
}
