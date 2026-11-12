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

# The flow network layer the catchment lookup reads (POST /flow-network/lookup).
#
# EMPTY BY DEFAULT, which uploads the committed test fixture: Govetts Creek
# only, so a click anywhere else in NSW answers "not covered". For the whole
# state, build it (topo/build_flow_network.py) and point this at it in a
# gitignored `*.auto.tfvars` beside this file, e.g.
#
#   flow_network_gpkg = "/home/you/logjam-data/flow-network.gpkg"
#
# A changed file is uploaded again on the next `make dev`; the API checks for
# a new one every five minutes and swaps it in without a restart.
variable "flow_network_gpkg" {
  type    = string
  default = ""
}
