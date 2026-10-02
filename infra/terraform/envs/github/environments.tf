# Each Environment is deployable from one ref pattern only. The AWS deploy and
# apply roles trust jobs in `prod` (infra/terraform/envs/prod/iam.tf,
# iam_apply.tf), so prod's policy is what keeps AWS admin on main: widening it
# widens who can assume those roles. Guard: tests/guards.tftest.hcl.
# `mobile-release` holds EXPO_TOKEN, which is set by hand; Terraform does not
# manage secrets.
locals {
  environments = {
    prod           = { branch_pattern = "main", tag_pattern = null }
    mobile-release = { branch_pattern = null, tag_pattern = "mobile-v*" }
  }

  # For the import only: GitHub does not show a deployment policy's ID to
  # Terraform before import, so these came from
  # `gh api repos/Zen-TM/logjam/environments/<env>/deployment-branch-policies`.
  deployment_policy_ids = {
    prod           = "61014124"
    mobile-release = "61260671"
  }
}

import {
  for_each = local.environments
  to       = github_repository_environment.this[each.key]
  id       = "${local.repository}:${each.key}"
}

resource "github_repository_environment" "this" {
  for_each    = local.environments
  repository  = github_repository.logjam.name
  environment = each.key

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

import {
  for_each = local.environments
  to       = github_repository_environment_deployment_policy.this[each.key]
  id       = "${local.repository}:${each.key}:${local.deployment_policy_ids[each.key]}"
}

resource "github_repository_environment_deployment_policy" "this" {
  for_each       = local.environments
  repository     = github_repository.logjam.name
  environment    = github_repository_environment.this[each.key].environment
  branch_pattern = each.value.branch_pattern
  tag_pattern    = each.value.tag_pattern
}

# Pull-request plans of envs/prod and envs/github run in this Environment, so
# each run waits for the maintainer's approval before it gets the AWS plan
# role or the plan App's key. Approving runs the PR's code with both: read
# its workflows, Terraform and infra/lambda first. Any branch may use it,
# since PR branches vary; the reviewer is the gate. Not in local.environments,
# which all carry a branch policy. Guard: tests/guards.tftest.hcl.
resource "github_repository_environment" "terraform_plan" {
  repository  = github_repository.logjam.name
  environment = "terraform-plan"

  reviewers {
    users = [local.maintainer_user_id]
  }

  # The maintainer approves the runs of their own PRs too.
  prevent_self_review = false

  lifecycle {
    prevent_destroy = true
  }
}
