# terraform -chdir=infra/terraform/envs/prod test   (offline: mocked providers)
#
# Who may assume the CI roles, and what Terraform reads back. Each assert
# names the mutation that turns it red. Each run plans only the resources it
# asserts on: a mocked provider cannot import, or refresh every resource here.

mock_provider "aws" {}
mock_provider "aws" {
  alias = "us_east_1"
}
mock_provider "random" {}
mock_provider "archive" {}

run "plan_role_trusts_only_approved_runs_and_main" {
  command = plan
  plan_options {
    target = [aws_iam_role.github_actions_plan]
  }

  # Mutation: adding a subject (a branch, `*`, a StringLike condition) or a
  # second statement lets workflows nobody approved assume the plan role.
  # pull_request is transitional: it goes when the plan jobs move into the
  # terraform-plan Environment.
  assert {
    condition = (
      length(jsondecode(aws_iam_role.github_actions_plan.assume_role_policy).Statement) == 1 &&
      keys(jsondecode(aws_iam_role.github_actions_plan.assume_role_policy).Statement[0].Condition) == ["StringEquals"] &&
      toset(jsondecode(aws_iam_role.github_actions_plan.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"]) == toset([
        "repo:Zen-TM/logjam:environment:terraform-plan",
        "repo:Zen-TM/logjam:pull_request",
        "repo:Zen-TM/logjam:ref:refs/heads/main",
      ])
    )
    error_message = "The plan role must trust only runs in the terraform-plan Environment and main."
  }
}

run "origin_verify_is_never_read_back" {
  command = plan
  plan_options {
    target = [aws_secretsmanager_secret_version.origin_verify]
  }

  # Mutation: going back to secret_string makes every plan read the value
  # with GetSecretValue, and puts it in the secret version's state.
  assert {
    condition = (
      aws_secretsmanager_secret_version.origin_verify.secret_string == null &&
      aws_secretsmanager_secret_version.origin_verify.secret_string_wo_version != null
    )
    error_message = "The origin-verify secret version must be write-only (secret_string_wo): no CI role may read secret values."
  }
}
