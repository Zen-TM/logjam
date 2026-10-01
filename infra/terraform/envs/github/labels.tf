# The labels the issue forms (.github/ISSUE_TEMPLATE/) and CONTRIBUTING.md
# use: a form cannot apply a label that does not exist. Other labels, such as
# the ones Dependabot creates, are left alone.
locals {
  labels = {
    bug      = { color = "d73a4a", description = "Something doesn't work as it should" }
    proposal = { color = "a2eeef", description = "A feature or change to agree before writing code" }
    triage   = { color = "fbca04", description = "Not yet looked at by the maintainer" }
    accepted = { color = "0e8a16", description = "Approach agreed: a pull request can follow" }
  }
}

import {
  for_each = local.labels
  to       = github_issue_label.this[each.key]
  id       = "${local.repository}:${each.key}"
}

resource "github_issue_label" "this" {
  for_each    = local.labels
  repository  = github_repository.logjam.name
  name        = each.key
  color       = each.value.color
  description = each.value.description
}
