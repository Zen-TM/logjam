import {
  to = github_repository.logjam
  id = "logjam"
}

resource "github_repository" "logjam" {
  name       = local.repository
  visibility = "public"

  has_issues      = true
  has_projects    = true
  has_wiki        = true
  has_discussions = false
  is_template     = false

  # Squash only: main stays linear, one commit per PR. The squash commit takes
  # the PR title and the PR's commit messages, not the PR description: the
  # commit messages carry each contributor's DCO Signed-off-by
  # (docs/decisions/0021-agpl-and-dco.md), and with PR_BODY main would lose
  # every sign-off without any check failing.
  allow_squash_merge          = true
  allow_merge_commit          = false
  allow_rebase_merge          = false
  squash_merge_commit_title   = "PR_TITLE"
  squash_merge_commit_message = "COMMIT_MESSAGES"
  allow_auto_merge            = false
  delete_branch_on_merge      = true
  web_commit_signoff_required = false

  archive_on_destroy = true

  lifecycle {
    prevent_destroy = true
  }
}
