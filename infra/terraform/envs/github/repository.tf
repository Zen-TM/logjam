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

  # advanced_security is left out: GitHub rejects it on a public repository,
  # where these two are free.
  security_and_analysis {
    secret_scanning {
      status = "enabled"
    }
    secret_scanning_push_protection {
      status = "enabled"
    }
  }

  archive_on_destroy = true

  lifecycle {
    prevent_destroy = true
  }
}

# Dependabot alerts. github_repository's own vulnerability_alerts is
# deprecated; leave it unset there, or the two resources toggle one switch.
# Referencing github_repository.logjam's name orders this after that
# resource's update, whose read would otherwise see the switch flip mid-apply.
# Destroying this resource turns the alerts off.
resource "github_repository_vulnerability_alerts" "logjam" {
  repository = github_repository.logjam.name
  enabled    = true

  lifecycle {
    prevent_destroy = true
  }
}

# Dependabot security updates: a pull request for each alert as it lands,
# outside the monthly version-update schedule. They honour the ignores in
# .github/dependabot.yml, so the Expo SDK holds still apply. Needs the alerts
# above, hence the reference.
resource "github_repository_dependabot_security_updates" "logjam" {
  repository = github_repository_vulnerability_alerts.logjam.repository
  enabled    = true
}
