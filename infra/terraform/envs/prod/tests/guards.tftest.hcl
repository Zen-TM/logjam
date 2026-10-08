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

  # Mutation: adding a subject (`pull_request`, a branch, `*`, a StringLike
  # condition) or a second statement lets workflows nobody approved assume
  # the plan role.
  assert {
    condition = (
      length(jsondecode(aws_iam_role.github_actions_plan.assume_role_policy).Statement) == 1 &&
      keys(jsondecode(aws_iam_role.github_actions_plan.assume_role_policy).Statement[0].Condition) == ["StringEquals"] &&
      toset(jsondecode(aws_iam_role.github_actions_plan.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"]) == toset([
        "repo:Zen-TM/logjam:environment:terraform-plan",
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

run "ci_reads_no_secret_or_user_data" {
  command = plan
  plan_options {
    target = [
      aws_iam_role_policy.gha_plan_readonly_privacy_deny,
      aws_iam_role_policy.gha_readonly_privacy_deny,
      aws_iam_policy.github_actions_apply_boundary,
    ]
  }

  # The Deny names the Cognito CMK, whose mocked ARN is otherwise unknown.
  override_resource {
    target          = aws_kms_key.cognito_email
    values          = { arn = "arn:aws:kms:ap-southeast-2:620853681701:key/mock" }
    override_during = plan
  }

  # Mutation: an Allow or a NotResource exception for one secret, or a
  # Resource narrower than "*", lets a CI role read that secret's value.
  assert {
    condition = alltrue([
      for p in [
        aws_iam_role_policy.gha_plan_readonly_privacy_deny.policy,
        aws_iam_role_policy.gha_readonly_privacy_deny.policy,
        aws_iam_policy.github_actions_apply_boundary.policy,
        ] : (
        anytrue([
          for st in jsondecode(p).Statement :
          st.Effect == "Deny" && try(st.Resource, null) == "*" && contains(flatten([st.Action]), "secretsmanager:GetSecretValue")
        ]) &&
        !anytrue([for st in jsondecode(p).Statement : st.Effect == "Allow" && strcontains(jsonencode(st.Action), "secretsmanager")]) &&
        !anytrue([for st in jsondecode(p).Statement : can(st.NotResource)])
      )
    ])
    error_message = "Every CI role and the apply boundary must deny GetSecretValue on every secret, with no exception (infra/AGENTS.md)."
  }

  # Mutation: dropping any of these from the Deny gives the plan and deploy
  # roles (through ReadOnlyAccess) a read of users' emails, the Postgres
  # logs with query text, the instance logs, or queued messages.
  assert {
    condition = alltrue([
      for a in [
        "cognito-idp:ListUsers", "cognito-idp:AdminGet*", "cognito-idp:AdminList*",
        "rds:DownloadDBLogFilePortion", "rds:DownloadCompleteDBLogFile",
        "logs:StartLiveTail", "logs:GetLogRecord", "logs:GetLogEvents",
        "elasticbeanstalk:RetrieveEnvironmentInfo",
        "sqs:ReceiveMessage", "ssm:GetParameter",
        ] : anytrue([
          for st in jsondecode(aws_iam_role_policy.gha_plan_readonly_privacy_deny.policy).Statement :
          st.Effect == "Deny" && contains(flatten([st.Action]), a)
      ])
    ])
    error_message = "The CI privacy Deny lost a statement that keeps user data and logs out of CI (local.ci_readonly_privacy_deny)."
  }
}

run "contributor_is_read_only_and_mfa_gated" {
  command = plan
  plan_options {
    target = [
      aws_iam_group_policy.contributor,
      aws_iam_group_policy_attachments_exclusive.contributor,
      aws_iam_group_policies_exclusive.contributor,
    ]
  }

  # A mocked provider cannot import the group the policies attach to.
  override_resource {
    target          = aws_iam_group.contributor
    values          = { name = "logjam-developers" }
    override_during = plan
  }

  override_resource {
    target          = aws_kms_key.cognito_email
    values          = { arn = "arn:aws:kms:ap-southeast-2:620853681701:key/mock" }
    override_during = plan
  }

  # Mutation: attaching any managed policy besides ReadOnlyAccess (a revived
  # broad one), adding a second inline policy, or switching either exclusive
  # resource off lets the contributor's grant widen past the CI plan role's.
  assert {
    condition = (
      toset(aws_iam_group_policy_attachments_exclusive.contributor.policy_arns) == toset(["arn:aws:iam::aws:policy/ReadOnlyAccess"]) &&
      toset(aws_iam_group_policies_exclusive.contributor.policy_names) == toset([aws_iam_group_policy.contributor.name])
    )
    error_message = "The contributor group may hold only ReadOnlyAccess and its one inline policy, managed exclusively."
  }

  # Mutation: dropping a statement from the shared privacy Deny, or building
  # the group policy without it, gives the contributor secret values, logs
  # and the user directory.
  assert {
    condition = alltrue([
      for st in jsondecode(local.ci_readonly_privacy_deny).Statement :
      contains(jsondecode(aws_iam_group_policy.contributor.policy).Statement, st)
    ])
    error_message = "The contributor group policy must carry every statement of the CI privacy Deny."
  }

  # Mutation: changing BoolIfExists to Bool, flipping the value to "true",
  # narrowing Resource, or turning NotAction into Action makes the gate
  # skippable or leaves most of the account open without MFA.
  assert {
    condition = anytrue([
      for st in jsondecode(aws_iam_group_policy.contributor.policy).Statement :
      st.Effect == "Deny" && st.Resource == "*" && can(st.NotAction) &&
      st.Condition == { BoolIfExists = { "aws:MultiFactorAuthPresent" = "false" } } &&
      !contains(st.NotAction, "iam:DeactivateMFADevice") && !contains(st.NotAction, "iam:DeleteVirtualMFADevice")
    ])
    error_message = "The contributor group must be denied everything but MFA enrolment without MFA."
  }

  # Mutation: an Allow outside the self-service set (his own password and
  # MFA) widens a read-only grant.
  assert {
    condition = alltrue([
      for st in jsondecode(aws_iam_group_policy.contributor.policy).Statement :
      st.Effect == "Deny" || alltrue([for a in flatten([st.Action]) : startswith(a, "iam:")])
    ])
    error_message = "The contributor group policy may Allow only IAM self-service actions."
  }

  # Mutation: growing the policy past the inline group limit (apply fails).
  assert {
    condition     = length(aws_iam_group_policy.contributor.policy) < 5120
    error_message = "The contributor group policy no longer fits the 5,120-character inline limit."
  }
}
