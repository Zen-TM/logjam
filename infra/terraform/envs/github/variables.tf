# Repository variables the workflows read: the public URLs smoke.yml probes
# after a deploy or rollback, and that rollback-compat.yml asks for the live
# release. Public URLs, not secrets.
locals {
  actions_variables = {
    PROD_API_URL = "https://api.logjamnsw.com"
    PROD_WEB_URL = "https://logjamnsw.com"
  }
}

import {
  for_each = local.actions_variables
  to       = github_actions_variable.this[each.key]
  id       = "${local.repository}:${each.key}"
}

resource "github_actions_variable" "this" {
  for_each      = local.actions_variables
  repository    = github_repository.logjam.name
  variable_name = each.key
  value         = each.value
}
