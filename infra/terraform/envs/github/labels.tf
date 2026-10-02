# The labels the issue forms (.github/ISSUE_TEMPLATE/) and CONTRIBUTING.md
# use: a form cannot apply a label that does not exist
# (shared/src/issueFormLabels.test.ts). `blocked` is for an
# issue waiting on an upstream release or another project, not for work merely
# deferred. Other labels, such as the ones Dependabot creates, are left alone.
locals {
  labels = {
    bug      = { color = "d73a4a", description = "Something doesn't work as it should" }
    proposal = { color = "a2eeef", description = "A feature or change to agree before writing code" }
    task     = { color = "c5def5", description = "Work with no change users see" }
    triage   = { color = "fbca04", description = "Not yet looked at by the maintainer" }
    accepted = { color = "0e8a16", description = "Approach agreed: a pull request can follow" }
    blocked  = { color = "b60205", description = "Waiting on something outside this repo; the issue says what." }
  }
}

# The labels that existed when this root took the settings over; later ones
# are created.
import {
  for_each = toset(["bug", "proposal", "triage", "accepted"])
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
