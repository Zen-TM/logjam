locals {
  # Repository admins (the maintainer) bypass every ruleset: they alone merge
  # to main and cut Logjam GPS releases. Guard: tests/guards.tftest.hcl.
  admin_bypass = {
    actor_id    = 5 # the built-in admin repository role
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
  }

  # plan-prod is the gate for merge = apply (terraform-plan.yml); a PR must be
  # up to date with main so its plan was made against the main it merges
  # into. api-image and topo-image (image-build.yml) build the Docker images
  # on a PR that changes what they are built from, and pass at once
  # otherwise. The list is the one live when this root took the settings
  # over, so that first plan imports and changes nothing; plan-github joins
  # it in a later change.
  required_checks = [
    "shared",
    "api",
    "frontend",
    "topo",
    "format",
    "actionlint",
    "plan-prod",
    "dco",
    "api-image",
    "topo-image",
  ]
}

import {
  to = github_repository_ruleset.main
  id = "logjam:23995449"
}

# A PR needs a CODEOWNERS approval (.github/CODEOWNERS), and a new push
# dismisses an earlier one. Only a bypass actor may update main at all (the
# update rule), so only the maintainer merges, and an approved PR does not let
# a collaborator merge it.
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

  bypass_actors {
    actor_id    = local.admin_bypass.actor_id
    actor_type  = local.admin_bypass.actor_type
    bypass_mode = local.admin_bypass.bypass_mode
  }

  rules {
    deletion                      = true
    non_fast_forward              = true
    required_linear_history       = true
    update                        = true
    update_allows_fetch_and_merge = false

    pull_request {
      required_approving_review_count   = 1
      require_code_owner_review         = true
      dismiss_stale_reviews_on_push     = true
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
