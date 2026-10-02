# terraform -chdir=infra/terraform/envs/github test   (offline: mocked provider)
#
# The settings the rest of the security model stands on. The apply App can
# change any of them, so a merged edit here is the only thing that can weaken
# them; these make that edit fail CI instead of passing unnoticed. Each assert
# names the mutation that turns it red.

mock_provider "github" {}

# A mocked provider cannot import; overriding the imported resources lets the
# plan run. The asserts read configured values, which overrides leave alone.
override_resource { target = github_repository.logjam }
override_resource { target = github_repository_ruleset.main }
override_resource { target = github_repository_ruleset.mobile_release_tags }
override_resource { target = github_repository_ruleset.mobile_release_branches }
override_resource { target = github_repository_environment.this }
override_resource { target = github_repository_environment_deployment_policy.this }
override_resource { target = github_actions_variable.this }
override_resource { target = github_actions_variable.plan_value_check }
override_resource { target = github_issue_label.this }

run "main_admits_only_green_squashed_prs" {
  command = plan

  # Mutation: adding any bypass actor to the main ruleset lets that actor
  # merge red, or push to main without a PR.
  assert {
    condition     = length(github_repository_ruleset.main.bypass_actors) == 0
    error_message = "The main ruleset must have no bypass actors: approval is bypassed in main-review instead (docs/decisions/0025-github-settings-in-terraform.md)."
  }

  # Mutation: turning either ruleset to evaluate or disabled, or pointing it
  # at another branch, switches off every rule below.
  assert {
    condition = alltrue([
      for rs in [github_repository_ruleset.main, github_repository_ruleset.main_review] :
      rs.enforcement == "active" && rs.conditions[0].ref_name[0].include == tolist(["~DEFAULT_BRANCH"])
    ])
    error_message = "The main and main-review rulesets must be active on the default branch."
  }

  # Mutation: dropping deletion, non_fast_forward or required_linear_history
  # lets main be deleted, rewritten, or merged into with a merge commit.
  assert {
    condition = alltrue([
      github_repository_ruleset.main.rules[0].deletion,
      github_repository_ruleset.main.rules[0].non_fast_forward,
      github_repository_ruleset.main.rules[0].required_linear_history,
    ])
    error_message = "The main ruleset must block deletion and force-pushes, and require linear history."
  }

  # Mutation: removing the pull_request rule lets anyone with write access
  # push to main; allowing merge or rebase drops the DCO sign-offs that
  # squash commits carry (docs/decisions/0021-agpl-and-dco.md).
  assert {
    condition = (
      length(github_repository_ruleset.main.rules[0].pull_request) == 1 &&
      github_repository_ruleset.main.rules[0].pull_request[0].allowed_merge_methods == tolist(["squash"])
    )
    error_message = "Every change to main must arrive by PR, squash-merged."
  }

  # Mutation: removing any of these from the required checks lets a PR merge
  # without it; plan-prod and plan-github are what merging applies. Turning
  # off strict lets a PR merge against a main it was not planned on.
  assert {
    condition = alltrue([
      for c in ["shared", "api", "frontend", "topo", "format", "actionlint", "plan-prod", "plan-github", "dco", "api-image", "topo-image", "gitleaks"] :
      contains([for r in github_repository_ruleset.main.rules[0].required_status_checks[0].required_check : r.context], c)
    ]) && github_repository_ruleset.main.rules[0].required_status_checks[0].strict_required_status_checks_policy
    error_message = "A required check left the main ruleset, or branches no longer need to be up to date. Add checks freely; removing one needs this test changed too."
  }
}

run "review_needs_a_code_owner" {
  command = plan

  # Mutation: turning off code-owner review, or requiring no approval, lets a
  # collaborator's PR merge unreviewed; turning off dismiss-stale lets a push
  # after approval merge unreviewed.
  assert {
    condition = (
      github_repository_ruleset.main_review.rules[0].pull_request[0].require_code_owner_review &&
      github_repository_ruleset.main_review.rules[0].pull_request[0].required_approving_review_count >= 1 &&
      github_repository_ruleset.main_review.rules[0].pull_request[0].dismiss_stale_reviews_on_push
    )
    error_message = "main-review must require a code owner's approval and dismiss it on a new push."
  }
}

run "prod_deploys_from_main_only" {
  command = plan

  # Mutation: widening prod's policy (another branch, protected_branches, or
  # no custom policy) lets a workflow on that branch assume the AWS deploy and
  # apply roles.
  assert {
    condition = (
      github_repository_environment.this["prod"].deployment_branch_policy[0].custom_branch_policies &&
      !github_repository_environment.this["prod"].deployment_branch_policy[0].protected_branches &&
      github_repository_environment_deployment_policy.this["prod"].branch_pattern == "main" &&
      github_repository_environment_deployment_policy.this["prod"].tag_pattern == null
    )
    error_message = "The prod Environment must be deployable from main and nothing else: the AWS roles trust it."
  }
}

run "releases_stay_the_maintainers" {
  command = plan

  # Mutation: dropping a rule or the admin-only bypass on either release
  # ruleset lets a collaborator cut a Logjam GPS release.
  assert {
    condition = alltrue(flatten([
      for rs in [github_repository_ruleset.mobile_release_tags, github_repository_ruleset.mobile_release_branches] : [
        rs.rules[0].creation, rs.rules[0].update, rs.rules[0].deletion,
        length(rs.bypass_actors) == 1,
        rs.bypass_actors[0].actor_id == 5,
      ]
    ]))
    error_message = "Only repository admins may create, move or delete mobile-v* tags and release/mobile-v* branches."
  }

  assert {
    condition     = github_repository_environment_deployment_policy.this["mobile-release"].tag_pattern == "mobile-v*"
    error_message = "The mobile-release Environment, which holds EXPO_TOKEN, must be deployable from mobile-v* tags only."
  }
}

run "squash_commits_keep_sign_offs" {
  command = plan

  # Mutation: PR_BODY (or BLANK) drops every contributor's Signed-off-by from
  # main (docs/decisions/0021-agpl-and-dco.md).
  assert {
    condition     = github_repository.logjam.squash_merge_commit_message == "COMMIT_MESSAGES"
    error_message = "Squash commits must take the PR's commit messages, which carry the DCO sign-offs."
  }
}

run "security_alerts_stay_on" {
  command = plan

  # Mutation: setting either status to "disabled", or deleting the
  # security_and_analysis block, lets a committed secret go unflagged or a
  # push that adds one through.
  assert {
    condition = (
      github_repository.logjam.security_and_analysis[0].secret_scanning[0].status == "enabled" &&
      github_repository.logjam.security_and_analysis[0].secret_scanning_push_protection[0].status == "enabled"
    )
    error_message = "Secret scanning and push protection must stay enabled."
  }

  # Mutation: enabled = false stops Dependabot alerting on vulnerable
  # dependencies; deleting the resource fails this run on the missing
  # reference.
  assert {
    condition     = github_repository_vulnerability_alerts.logjam.enabled
    error_message = "Dependabot alerts must stay enabled."
  }

  # Mutation: enabled = false leaves alerts piling up with no fix pull
  # requests; deleting the resource fails this run on the missing reference.
  assert {
    condition     = github_repository_dependabot_security_updates.logjam.enabled
    error_message = "Dependabot security updates must stay enabled."
  }
}
