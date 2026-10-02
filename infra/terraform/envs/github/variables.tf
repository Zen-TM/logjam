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

# Not imported: created by the first apply. `report` or `enforce`: whether the
# apply refuses a plan whose values differ from the PR's, or only says so
# (docs/decisions/0026-plan-fingerprint-covers-planned-values.md). Flipping it is a
# reviewed PR. The key for those value fingerprints, PLAN_FINGERPRINT_KEY, is a
# secret set by hand (infra/AGENTS.md).
resource "github_actions_variable" "plan_value_check" {
  repository    = github_repository.logjam.name
  variable_name = "PLAN_VALUE_CHECK"
  value         = "report"
}
