locals {
  # Repository admins (the maintainer) may bypass the review ruleset, so
  # their own PRs merge without the approval GitHub never lets an author give
  # themselves, and they alone cut Logjam GPS releases. They may not bypass
  # the main ruleset: nobody merges red. Guard: tests/guards.tftest.hcl.
  admin_bypass = {
    actor_id    = 5 # the built-in admin repository role
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
  }

  # plan-prod and plan-github are the gates for merge = apply
  # (terraform-plan.yml); a PR must be up to date with main so its plan was
  # made against the main it merges into. api-image and topo-image
  # (image-build.yml) build the Docker images on a PR that changes what they
  # are built from, and pass at once otherwise. gitleaks (ci.yml) catches
  # what push protection cannot: it knows only providers' key formats, while
  # gitleaks also flags generic high-entropy secrets. The heavy jobs
  # (api-integration, mobile, migrations, migration-upgrade, topo-e2e,
  # rollback-compat's "Live release on this schema", terraform-ci's,
  # setup-smoke) skip, and so pass, on a PR that touches nothing they test
  # (infra/scripts/ci-scope.sh); dependency-review passes when no manifest
  # changed, and expo-doctor when the PR is not a Logjam GPS release. Each
  # workflow starts on every PR: a required check whose workflow never starts
  # leaves the PR waiting.
  required_checks = [
    "shared",
    "api",
    "api-integration",
    "frontend",
    "mobile",
    "topo",
    "migrations",
    "migration-upgrade",
    "infra-scripts",
    "topo-e2e",
    "Live release on this schema",
    "plan-summary",
    "fmt",
    "validate",
    "test-github",
    "test-prod",
    "dependency-review",
    "setup-smoke",
    "format",
    "actionlint",
    "plan-prod",
    "plan-github",
    "dco",
    "api-image",
    "topo-image",
    "gitleaks",
    "pr-closes",
    "expo-doctor",
  ]
}

import {
  to = github_repository_ruleset.main
  id = "logjam:23995449"
}

# What every change to main must pass, with no bypass for anyone: it arrives
# by PR, squashed, green and up to date, and main is never rewritten or
# deleted. Approval lives in a separate ruleset (main_review below) because a
# bypass skips every rule of the ruleset it is on: with approval here, the
# maintainer's own PRs could only merge by also skipping the required checks.
# There is no update rule, so whoever may merge a PR (write access) can merge
# one that is approved and green.
resource "github_repository_ruleset" "main" {
  name        = "main"
  repository  = github_repository.logjam.name
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    deletion                = true
    non_fast_forward        = true
    required_linear_history = true

    pull_request {
      required_approving_review_count   = 0
      require_code_owner_review         = false
      dismiss_stale_reviews_on_push     = false
      require_last_push_approval        = false
      required_review_thread_resolution = false
      allowed_merge_methods             = ["squash"]
    }

    required_status_checks {
      strict_required_status_checks_policy = true

      dynamic "required_check" {
        for_each = local.required_checks
        content {
          context = required_check.value
        }
      }
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# A PR needs a code owner's approval (.github/CODEOWNERS), and a push after
# it dismisses it. Admins may bypass this ruleset alone.
resource "github_repository_ruleset" "main_review" {
  name        = "main-review"
  repository  = github_repository.logjam.name
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  bypass_actors {
    actor_id    = local.admin_bypass.actor_id
    actor_type  = local.admin_bypass.actor_type
    bypass_mode = local.admin_bypass.bypass_mode
  }

  rules {
    pull_request {
      required_approving_review_count   = 1
      require_code_owner_review         = true
      dismiss_stale_reviews_on_push     = true
      require_last_push_approval        = false
      required_review_thread_resolution = false
      allowed_merge_methods             = ["squash"]
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# A mobile-v* tag push is a Logjam GPS release (deploy-mobile.yml), and the
# workflow also accepts a tag on a release/mobile-v* branch: only admins may
# create, move or delete either.
import {
  to = github_repository_ruleset.mobile_release_tags
  id = "logjam:24101808"
}

resource "github_repository_ruleset" "mobile_release_tags" {
  name        = "mobile-release-tags"
  repository  = github_repository.logjam.name
  target      = "tag"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["refs/tags/mobile-v*"]
      exclude = []
    }
  }

  bypass_actors {
    actor_id    = local.admin_bypass.actor_id
    actor_type  = local.admin_bypass.actor_type
    bypass_mode = local.admin_bypass.bypass_mode
  }

  rules {
    creation = true
    update   = true
    deletion = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = github_repository_ruleset.mobile_release_branches
  id = "logjam:24101809"
}

resource "github_repository_ruleset" "mobile_release_branches" {
  name        = "mobile-release-branches"
  repository  = github_repository.logjam.name
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["refs/heads/release/mobile-v*"]
      exclude = []
    }
  }

  bypass_actors {
    actor_id    = local.admin_bypass.actor_id
    actor_type  = local.admin_bypass.actor_type
    bypass_mode = local.admin_bypass.bypass_mode
  }

  rules {
    creation = true
    update   = true
    deletion = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

# A maplibre-android-v* tag holds the patched MapLibre Android the Logjam GPS
# build downloads (mobile/plugins/withPatchedMapLibre.js). Anyone may cut a new
# one; only admins may move or delete one, so the release a build pins never
# changes under it. Guard: tests/guards.tftest.hcl.
resource "github_repository_ruleset" "maplibre_android_tags" {
  name        = "maplibre-android-tags"
  repository  = github_repository.logjam.name
  target      = "tag"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["refs/tags/maplibre-android-v*"]
      exclude = []
    }
  }

  bypass_actors {
    actor_id    = local.admin_bypass.actor_id
    actor_type  = local.admin_bypass.actor_type
    bypass_mode = local.admin_bypass.bypass_mode
  }

  rules {
    update   = true
    deletion = true
  }

  lifecycle {
    prevent_destroy = true
  }
}
