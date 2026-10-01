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
override_resource { target = github_issue_label.this }

run "main_stays_the_maintainers" {
  command = plan

  # Mutation: removing the admin bypass leaves nobody able to merge, since the
  # update rule then blocks every push to main.
  assert {
    condition = anytrue([
      for b in github_repository_ruleset.main.bypass_actors :
      b.actor_type == "RepositoryRole" && b.actor_id == 5 && b.bypass_mode == "always"
    ])
    error_message = "The main ruleset must let repository admins bypass it: only they merge."
  }

  # Mutation: dropping update, deletion or non_fast_forward lets a collaborator
  # push to, rewrite or delete main.
  assert {
    condition = alltrue([
      github_repository_ruleset.main.rules[0].update,
      github_repository_ruleset.main.rules[0].deletion,
      github_repository_ruleset.main.rules[0].non_fast_forward,
    ])
    error_message = "The main ruleset must block updates, deletion and force-pushes by anyone but a bypass actor."
  }

  # Mutation: removing plan-prod from the required checks lets a PR merge,
  # and so apply, without a plan anyone read; turning off strict lets it merge
  # against a main it was not planned on.
  assert {
    condition = (
      contains([for r in github_repository_ruleset.main.rules[0].required_status_checks[0].required_check : r.context], "plan-prod") &&
      github_repository_ruleset.main.rules[0].required_status_checks[0].strict_required_status_checks_policy
    )
    error_message = "plan-prod must be a required check, with branches up to date: merging applies."
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
