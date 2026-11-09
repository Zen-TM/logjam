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
  # condition) or a second statement lets workflows outside the
  # terraform-plan Environment and main assume the plan role.
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
        !anytrue([for st in jsondecode(p).Statement : can(st.NotResource) && !alltrue([for a in flatten([st.Action]) : startswith(a, "s3:")])])
      )
    ])
    error_message = "Every CI role and the apply boundary must deny GetSecretValue on every secret, with no exception (infra/AGENTS.md)."
  }

  # Mutation: adding `arn:aws:s3:::logjam-brain-signals-620853681701/*` (or the
  # backup bucket, or a `logjam-brain*` pattern) to the object Deny's
  # NotResource, or dropping the Deny, lets the plan, deploy and apply roles
  # read the brain's signals bucket. CI only writes release.json there.
  assert {
    condition = alltrue([
      for p in [
        aws_iam_role_policy.gha_plan_readonly_privacy_deny.policy,
        aws_iam_role_policy.gha_readonly_privacy_deny.policy,
        aws_iam_policy.github_actions_apply_boundary.policy,
        ] : anytrue([
          for st in jsondecode(p).Statement :
          st.Effect == "Deny" && contains(flatten([st.Action]), "s3:GetObject") && can(st.NotResource) &&
          !anytrue([for r in st.NotResource : r == "*" || startswith(r, "arn:aws:s3:::logjam-brain")])
      ])
    ])
    error_message = "No CI role may read objects from the brain's signals or backup bucket (infra/AGENTS.md)."
  }

  # Mutation: turning the object Deny back into a list of buckets, adding a
  # bucket to its exceptions, or scoping the log Deny to named log groups
  # leaves the next bucket or log group readable until someone remembers to
  # add it. Changing the object Deny's condition (another account, a
  # negated operator, a second key) leaves buckets of ours readable; dropping
  # it denies the AWS-owned objects an EB configuration change reads again.
  assert {
    condition = alltrue([
      for p in [
        aws_iam_role_policy.gha_plan_readonly_privacy_deny.policy,
        aws_iam_role_policy.gha_readonly_privacy_deny.policy,
        aws_iam_policy.github_actions_apply_boundary.policy,
        ] : (
        anytrue([
          for st in jsondecode(p).Statement :
          st.Effect == "Deny" && contains(flatten([st.Action]), "s3:GetObject") &&
          toset(try(st.NotResource, [])) == toset([
            "arn:aws:s3:::logjam-tfstate-620853681701/*",
            "arn:aws:s3:::logjam-frontend-620853681701-ap-southeast-2-an/*",
            "arn:aws:s3:::elasticbeanstalk-ap-southeast-2-620853681701/*",
          ]) &&
          try(st.Condition, null) == { StringEquals = { "aws:ResourceAccount" = "620853681701" } }
        ]) &&
        anytrue([
          for st in jsondecode(p).Statement :
          st.Effect == "Deny" && try(st.Resource, null) == "*" &&
          length(setsubtract(["logs:GetLogEvents", "logs:FilterLogEvents", "logs:StartQuery", "logs:GetQueryResults", "logs:StartLiveTail"], flatten([st.Action]))) == 0
        ])
      )
    ])
    error_message = "The CI privacy Deny must cover objects in every bucket of this account but the three CI reads, and events in every log group (local.ci_readonly_privacy_deny)."
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
      aws_iam_user_policy_attachments_exclusive.contributor,
      aws_iam_user_policies_exclusive.contributor,
    ]
  }

  # A mocked provider cannot import the group or the user the policies
  # attach to.
  override_resource {
    target          = aws_iam_group.contributor
    values          = { name = "logjam-developers" }
    override_during = plan
  }

  override_resource {
    target          = aws_iam_user.contributor
    values          = { name = "collaborator-oliver" }
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
    error_message = "The contributor group may hold only ReadOnlyAccess and its one inline policy, managed exclusively (docs/decisions/0032)."
  }

  # Red when a policy is attached to the user directly in Terraform, or when
  # either exclusive resource is removed: a direct grant would sit beside the
  # group's and not be covered by the asserts in this run.
  assert {
    condition = (
      length(aws_iam_user_policy_attachments_exclusive.contributor.policy_arns) == 0 &&
      length(aws_iam_user_policies_exclusive.contributor.policy_names) == 0
    )
    error_message = "The contributor user may hold no policy of its own; the grant comes through the group."
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

  # Mutation: the same as for the CI roles: a NotResource entry for the brain's
  # signals or backup bucket in the group's object Deny lets the contributor
  # read it.
  assert {
    condition = anytrue([
      for st in jsondecode(aws_iam_group_policy.contributor.policy).Statement :
      st.Effect == "Deny" && contains(flatten([st.Action]), "s3:GetObject") && can(st.NotResource) &&
      !anytrue([for r in st.NotResource : r == "*" || startswith(r, "arn:aws:s3:::logjam-brain")])
    ])
    error_message = "The contributor group may not read objects from the brain's signals or backup bucket."
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
    error_message = "The contributor group must be denied everything but MFA enrolment without MFA (docs/decisions/0032)."
  }

  # Mutation: an Allow outside the self-service set (his own password and
  # MFA) widens a read-only grant.
  assert {
    condition = alltrue([
      for st in jsondecode(aws_iam_group_policy.contributor.policy).Statement :
      st.Effect == "Deny" || alltrue([for a in flatten([st.Action]) : startswith(a, "iam:")])
    ])
    error_message = "The contributor group policy may Allow only IAM self-service actions: a contributor changes AWS through a PR (docs/decisions/0032)."
  }

  # Mutation: dropping the statement, or narrowing it to one key, lets the
  # contributor download the Terraform state.
  assert {
    condition = anytrue([
      for st in jsondecode(aws_iam_group_policy.contributor.policy).Statement :
      st.Effect == "Deny" && try(st.Resource, null) == "arn:aws:s3:::logjam-tfstate-620853681701/*" &&
      contains(flatten([st.Action]), "s3:GetObject") && contains(flatten([st.Action]), "s3:GetObjectVersion")
    ])
    error_message = "The contributor group must be denied every object in the state bucket (docs/decisions/0032)."
  }

  # Mutation: growing the policy past the inline group limit (apply fails).
  assert {
    condition     = length(aws_iam_group_policy.contributor.policy) < 5120
    error_message = "The contributor group policy no longer fits the 5,120-character inline limit."
  }
}

run "place_registry_role_writes_only_master_places" {
  command = plan
  plan_options {
    target = [aws_iam_role_policy.place_registry]
  }

  # Mutation: widening a Resource (`/*`, `/master/*`) or the list prefix,
  # dropping the prefix condition, or adding an action or a statement lets the
  # monthly build see, write or delete more than the public place registry.
  assert {
    condition = jsondecode(aws_iam_role_policy.place_registry.policy).Statement == [
      {
        Sid      = "PublishPlaceRegistry"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "arn:aws:s3:::logjam-topo-jobs/master/places/*"
      },
      {
        Sid       = "ListPlaceRegistry"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = "arn:aws:s3:::logjam-topo-jobs"
        Condition = { StringLike = { "s3:prefix" = "master/places/*" } }
      },
    ]
    error_message = "The place registry role may only list, read and write objects under master/places/ in the topo bucket."
  }
}

run "gauges_role_writes_only_master_gauges" {
  command = plan
  plan_options {
    target = [aws_iam_role_policy.gauges]
  }

  # Mutation: widening a Resource (`/*`, `/master/*`) or the list prefix,
  # dropping the prefix condition, or adding an action or a statement lets the
  # gauges job see, write or delete more than the public gauge files.
  assert {
    condition = jsondecode(aws_iam_role_policy.gauges.policy).Statement == [
      {
        Sid      = "PublishGauges"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "arn:aws:s3:::logjam-topo-jobs/master/gauges/*"
      },
      {
        Sid       = "ListGauges"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = "arn:aws:s3:::logjam-topo-jobs"
        Condition = { StringLike = { "s3:prefix" = "master/gauges/*" } }
      },
    ]
    error_message = "The gauges role may only list, read and write objects under master/gauges/ in the topo bucket."
  }
}

run "fire_history_role_writes_only_fire" {
  command = plan
  plan_options {
    target = [aws_iam_role_policy.fire_history]
  }

  # Mutation: widening a Resource (`/*`) or the list prefix, dropping the
  # prefix condition, or adding an action or a statement lets the monthly
  # build see, write or delete more than the fire history raster and the
  # Fire history overlay's archive.
  assert {
    condition = jsondecode(aws_iam_role_policy.fire_history.policy).Statement == [
      {
        Sid      = "PublishFireHistory"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "arn:aws:s3:::logjam-topo-jobs/fire/*"
      },
      {
        Sid      = "PublishFireOverlay"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "arn:aws:s3:::logjam-topo-jobs/master/fire/*"
      },
      {
        Sid       = "ListFireHistory"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = "arn:aws:s3:::logjam-topo-jobs"
        Condition = { StringLike = { "s3:prefix" = "fire/*" } }
      },
    ]
    error_message = "The fire history role may only list, read and write objects under fire/ in the topo bucket, and write them under master/fire/."
  }
}

run "pin_role_passes_every_topo_task_role" {
  command = plan
  plan_options {
    target = [
      aws_iam_role_policy.gha_pin_task_defs,
      aws_iam_role_policy.fire_history_scheduler,
      aws_ecs_task_definition.topo_worker,
      aws_ecs_task_definition.topo_export_worker,
      aws_ecs_task_definition.place_registry,
      aws_ecs_task_definition.gauges,
      aws_ecs_task_definition.fire_history,
      aws_ecs_task_definition.coverage,
    ]
  }

  # A mocked provider makes up no ARN to compare: each role gets its own.
  override_resource {
    target          = aws_iam_role.ecs_task_execution
    values          = { arn = "arn:aws:iam::620853681701:role/mock-execution" }
    override_during = plan
  }
  override_resource {
    target          = aws_iam_role.topo_worker
    values          = { arn = "arn:aws:iam::620853681701:role/logjam-topo-worker-role" }
    override_during = plan
  }
  override_resource {
    target          = aws_iam_role.place_registry
    values          = { arn = "arn:aws:iam::620853681701:role/mock-place-registry" }
    override_during = plan
  }
  override_resource {
    target          = aws_iam_role.gauges
    values          = { arn = "arn:aws:iam::620853681701:role/mock-gauges" }
    override_during = plan
  }
  override_resource {
    target          = aws_iam_role.fire_history
    values          = { arn = "arn:aws:iam::620853681701:role/mock-fire-history" }
    override_during = plan
  }
  override_resource {
    target          = aws_iam_role.coverage
    values          = { arn = "arn:aws:iam::620853681701:role/mock-coverage" }
    override_during = plan
  }
  override_resource {
    target = aws_ecs_task_definition.fire_history
    values = {
      arn                  = "arn:aws:ecs:ap-southeast-2:620853681701:task-definition/logjam-fire-history:1"
      arn_without_revision = "arn:aws:ecs:ap-southeast-2:620853681701:task-definition/logjam-fire-history"
    }
    override_during = plan
  }
  override_resource {
    target          = aws_ecs_cluster.main
    values          = { arn = "arn:aws:ecs:ap-southeast-2:620853681701:cluster/mock" }
    override_during = plan
  }

  # Mutation: leave a topo-image task's role, or the execution role, out of
  # PassWorkerRoles, and pin-release.sh's re-registration of that family is
  # refused, so every topo deploy and worker rollback fails. The list here is
  # held to pin-release.sh's families by its --self-test.
  assert {
    condition = alltrue([
      for arn in [
        aws_iam_role.ecs_task_execution.arn,
        aws_ecs_task_definition.topo_worker.task_role_arn,
        aws_ecs_task_definition.topo_export_worker.task_role_arn,
        aws_ecs_task_definition.place_registry.task_role_arn,
        aws_ecs_task_definition.gauges.task_role_arn,
        aws_ecs_task_definition.fire_history.task_role_arn,
        aws_ecs_task_definition.coverage.task_role_arn,
        ] : contains(one([
          for s in jsondecode(aws_iam_role_policy.gha_pin_task_defs.policy).Statement : s
          if try(s.Sid, "") == "PassWorkerRoles"
      ]).Resource, arn)
    ])
    error_message = "The pin role must be able to pass the execution role and the task role of every family pin-release.sh pins for the topo image."
  }

  # Mutation: add another task's role to the fire history scheduler's
  # PassRole, and the schedule can launch a task with more than its own grant.
  assert {
    condition = toset(one([
      for s in jsondecode(aws_iam_role_policy.fire_history_scheduler.policy).Statement : s
      if try(s.Sid, "") == "PassFireHistoryRoles"
    ]).Resource) == toset([aws_iam_role.ecs_task_execution.arn, aws_iam_role.fire_history.arn])
    error_message = "The fire history scheduler may pass only the execution role and the fire history task role."
  }
}

run "coverage_role_writes_only_master_coverage" {
  command = plan
  plan_options {
    target = [aws_iam_role_policy.coverage]
  }

  # Mutation: widening a Resource (`/*`) or the list prefix, dropping the
  # prefix condition, or adding an action or a statement lets the monthly
  # build see, write or delete more than the Coverage archive and its state.
  assert {
    condition = jsondecode(aws_iam_role_policy.coverage.policy).Statement == [
      {
        Sid      = "PublishCoverage"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "arn:aws:s3:::logjam-topo-jobs/master/coverage/*"
      },
      {
        Sid       = "ListCoverage"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = "arn:aws:s3:::logjam-topo-jobs"
        Condition = { StringLike = { "s3:prefix" = "master/coverage/*" } }
      },
    ]
    error_message = "The coverage role may only list, read and write objects under master/coverage/ in the topo bucket."
  }
}

run "api_rate_limit_is_one_plain_ip_rule" {
  command = plan
  plan_options {
    target = [aws_wafv2_web_acl.api]
  }

  # The api distribution's CloudFront flat-rate pricing plan refused a
  # rate-based rule scoped by URI path (WAFFeatureNotIncludedInPricingPlanException),
  # failing the prod apply. Mutation: give any API rule a scope_down_statement,
  # or change rule 0's limit, key or action, and this turns red.
  assert {
    condition = (
      alltrue([for r in aws_wafv2_web_acl.api.rule :
        length(try(r.statement[0].rate_based_statement[0].scope_down_statement, [])) == 0
      ]) &&
      [for r in aws_wafv2_web_acl.api.rule : [
        r.statement[0].rate_based_statement[0].limit,
        r.statement[0].rate_based_statement[0].aggregate_key_type,
        r.action[0].block != [],
      ] if r.priority == 0] == [[300, "IP", true]]
    )
    error_message = "The API web ACL's rate limit must stay one plain 300 per 5 min per-IP block rule, with no rule scoped down: the CloudFront pricing plan refuses scoped rules."
  }
}

run "postgres_errors_log_no_row_values" {
  command = plan
  plan_options {
    target = [aws_db_parameter_group.pgaudit]
  }

  # At the default verbosity, a constraint violation logs a DETAIL line with
  # the failing row's values ("Failing row contains (...)"), which can carry a
  # place's name or coordinates into the postgresql log and its WORM sink.
  # Mutation: drop the log_error_verbosity parameter, or set it to "default"
  # or "verbose", and this turns red.
  assert {
    condition = contains([
      for p in aws_db_parameter_group.pgaudit.parameter : p.value if p.name == "log_error_verbosity"
    ], "terse")
    error_message = "The RDS parameter group must set log_error_verbosity = terse, so Postgres errors never log row values."
  }
}

run "cognito_client_scopes_and_api_grant" {
  command = plan
  plan_options {
    target = [aws_cognito_user_pool_client.main, aws_iam_role_policy.eb_cognito_admin_getuser]
  }

  # Mutation: dropping `aws.cognito.signin.user.admin` breaks change-email
  # and sign-out everywhere; dropping `profile` leaves the code flow's ID
  # token without profile claims. Neither fails a plan or a deploy.
  assert {
    condition     = length(setintersection(aws_cognito_user_pool_client.main.allowed_oauth_scopes, ["aws.cognito.signin.user.admin", "profile"])) == 2
    error_message = "The app client must allow the aws.cognito.signin.user.admin and profile scopes (cognito.tf)."
  }

  # Mutation: adding any action (a revived AdminCreateUser, ListUsers) or a
  # second statement widens what a compromised API can do to the user
  # directory; dropping AdminDeleteUser makes account deletion fail at Cognito.
  assert {
    condition = (
      length(jsondecode(aws_iam_role_policy.eb_cognito_admin_getuser.policy).Statement) == 1 &&
      toset(flatten([jsondecode(aws_iam_role_policy.eb_cognito_admin_getuser.policy).Statement[0].Action])) == toset(["cognito-idp:AdminGetUser", "cognito-idp:AdminDeleteUser"]) &&
      jsondecode(aws_iam_role_policy.eb_cognito_admin_getuser.policy).Statement[0].Resource == "arn:aws:cognito-idp:ap-southeast-2:620853681701:userpool/ap-southeast-2_x5zPhJXMk"
    )
    error_message = "The API's Cognito grant must be exactly AdminGetUser and AdminDeleteUser on the one pool (iam.tf)."
  }
}

# ── The brain (brain_*.tf) ───────────────────────────────────────────────────

run "brain_postgres_image_is_immutable" {
  command = plan
  plan_options {
    target = [aws_ecr_repository.brain_postgres]
  }

  # Mutation: setting image_tag_mutability back to MUTABLE lets a push
  # replace the tag the brain's instance is pinned to.
  assert {
    condition     = aws_ecr_repository.brain_postgres.image_tag_mutability == "IMMUTABLE"
    error_message = "The brain's Postgres image repository must keep immutable tags: the instance is pinned to one."
  }
}

run "brain_backups_are_locked_and_never_expire" {
  command = plan
  plan_options {
    target = [
      aws_s3_bucket_object_lock_configuration.brain_backups,
      aws_s3_bucket_lifecycle_configuration.brain_backups,
    ]
  }

  # Mutation: GOVERNANCE mode (anyone with the bypass permission can delete
  # backups), fewer than 7 days, or no default retention.
  assert {
    condition = (
      aws_s3_bucket_object_lock_configuration.brain_backups.rule[0].default_retention[0].mode == "COMPLIANCE" &&
      aws_s3_bucket_object_lock_configuration.brain_backups.rule[0].default_retention[0].days == 7
    )
    error_message = "The backup bucket must hold every object under a 7-day COMPLIANCE lock."
  }

  # Mutation: an `expiration { days = N }` (or a `date`) on any rule, or a
  # `transition`. pgBackRest expires backups by count; an age rule would delete
  # the only backup after a run of failed nights. (An expiration with a `days`
  # leaves expired_object_delete_marker unknown, so that mutation ends the run
  # with an "Unknown condition value" error rather than the message below.)
  assert {
    condition = alltrue([
      for r in aws_s3_bucket_lifecycle_configuration.brain_backups.rule : (
        alltrue([for e in r.expiration : e.expired_object_delete_marker == true]) &&
        length(r.transition) == 0
      )
    ])
    error_message = "No lifecycle rule on the backup bucket may expire or move current versions (infra/AGENTS.md)."
  }

  # Mutation: removing the noncurrent-version rule lets versions pile up for
  # ever (the bucket is the most expensive thing here if it does).
  assert {
    condition = anytrue([
      for r in aws_s3_bucket_lifecycle_configuration.brain_backups.rule :
      anytrue([for n in r.noncurrent_version_expiration : n.noncurrent_days == 1])
    ])
    error_message = "The backup bucket must expire noncurrent versions after 1 day."
  }
}

run "brain_deploy_role_writes_only_release_json" {
  command = plan
  plan_options {
    target = [aws_iam_role_policy.gha_brain_deploy]
  }

  override_resource {
    target          = aws_ecr_repository.brain_postgres
    values          = { arn = "arn:aws:ecr:ap-southeast-2:620853681701:repository/logjam-brain-postgres" }
    override_during = plan
  }
  override_resource {
    target          = aws_s3_bucket.brain_signals
    values          = { arn = "arn:aws:s3:::logjam-brain-signals-620853681701" }
    override_during = plan
  }

  # Mutation: widening the S3 resource (`/*`, the bucket, `serving`,
  # `status.json`) or adding an action lets CI write what the brain runs or
  # whether it serves; adding another repository lets CI push images the
  # brain pulls.
  assert {
    condition = (
      [for st in jsondecode(aws_iam_role_policy.gha_brain_deploy.policy).Statement : st.Resource] == [
        "arn:aws:ecr:ap-southeast-2:620853681701:repository/logjam-brain-postgres",
        "arn:aws:s3:::logjam-brain-signals-620853681701/release.json",
      ] &&
      one([
        for st in jsondecode(aws_iam_role_policy.gha_brain_deploy.policy).Statement : flatten([st.Action])
        if anytrue([for a in flatten([st.Action]) : startswith(a, "s3:")])
      ]) == ["s3:PutObject"]
    )
    error_message = "The deploy role may push only the brain Postgres image and write only release.json in the signals bucket."
  }
}

run "brain_security_group_has_two_ingress_rules" {
  command = plan
  plan_options {
    target = [aws_security_group.brain]
  }

  override_resource {
    target          = aws_security_group.worker
    values          = { id = "sg-mockworker" }
    override_during = plan
  }

  # Mutation: a third ingress rule, 0.0.0.0/0 or a CIDR on either, another port,
  # or a source other than the CloudFront prefix list (80) and the worker
  # group (5432) exposes the API or the database directly.
  assert {
    condition = toset([
      for i in aws_security_group.brain.ingress : jsonencode([i.from_port, i.to_port, i.protocol, i.prefix_list_ids == null ? [] : sort(tolist(i.prefix_list_ids)), i.security_groups == null ? [] : sort(tolist(i.security_groups)), i.cidr_blocks == null ? 0 : length(i.cidr_blocks), i.ipv6_cidr_blocks == null ? 0 : length(i.ipv6_cidr_blocks), i.self == true])
      ]) == toset([
      jsonencode([80, 80, "tcp", ["pl-b8a742d1"], [], 0, 0, false]),
      jsonencode([5432, 5432, "tcp", [], ["sg-mockworker"], 0, 0, false]),
    ]) && length(aws_security_group.brain.ingress) == 2
    error_message = "The brain's security group may take only port 80 from CloudFront and 5432 from the workers."
  }
}

run "brain_role_has_only_its_grants" {
  command = plan
  plan_options {
    target = [
      aws_iam_role_policy.brain,
      aws_iam_role_policy_attachments_exclusive.brain,
      aws_iam_role_policies_exclusive.brain,
    ]
  }

  override_resource {
    target          = aws_secretsmanager_secret.app_db
    values          = { arn = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/app-db-password-mock" }
    override_during = plan
  }
  override_resource {
    target          = aws_secretsmanager_secret.origin_verify
    values          = { arn = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/origin-verify-mock" }
    override_during = plan
  }
  override_resource {
    target          = aws_iam_role.topo_worker
    values          = { arn = "arn:aws:iam::620853681701:role/logjam-topo-worker-role" }
    override_during = plan
  }
  override_resource {
    target          = aws_iam_role.ecs_task_execution
    values          = { arn = "arn:aws:iam::620853681701:role/ecsTaskExecutionRole" }
    override_during = plan
  }
  override_resource {
    target          = aws_ecr_repository.api
    values          = { arn = "arn:aws:ecr:ap-southeast-2:620853681701:repository/logjam-api" }
    override_during = plan
  }
  override_resource {
    target          = aws_ecr_repository.brain_postgres
    values          = { arn = "arn:aws:ecr:ap-southeast-2:620853681701:repository/logjam-brain-postgres" }
    override_during = plan
  }
  override_resource {
    target          = aws_s3_bucket.brain_backups
    values          = { arn = "arn:aws:s3:::logjam-brain-backups-620853681701" }
    override_during = plan
  }
  override_resource {
    target          = aws_s3_bucket.brain_signals
    values          = { arn = "arn:aws:s3:::logjam-brain-signals-620853681701" }
    override_during = plan
  }

  # Mutation: attaching a managed policy (CloudWatchFullAccess, a revived
  # AmazonS3FullAccess) or a second inline policy by hand in Terraform, or
  # dropping either exclusive resource, widens a role the whole API runs as.
  assert {
    condition = (
      toset(aws_iam_role_policy_attachments_exclusive.brain.policy_arns) == toset(["arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"]) &&
      toset(aws_iam_role_policies_exclusive.brain.policy_names) == toset([aws_iam_role_policy.brain.name])
    )
    error_message = "The brain's role may hold only the Session Manager policy and its one inline policy, managed exclusively."
  }

  # Mutation: adding any bucket (the audit bucket above all), or a wildcard
  # resource, to an S3 statement lets a compromised API read or overwrite the
  # audit trail, the state or another bucket. The audit bucket is named so
  # that the next edit has to look at this list.
  assert {
    condition = alltrue([
      for r in flatten([
        for st in jsondecode(aws_iam_role_policy.brain.policy).Statement : flatten([st.Resource])
        if anytrue([for a in flatten([st.Action]) : startswith(a, "s3:")])
        ]) : contains([
        "logjam-media", "logjam-topo-jobs", "logjam-access-logs-620853681701",
        "logjam-brain-backups-620853681701", "logjam-brain-signals-620853681701",
      ], regex("^arn:aws:s3:::([^/]+)", r)[0])
    ])
    error_message = "The brain's role may reach only the media, topo, access-log, backup and signals buckets: never the audit bucket."
  }

  # Mutation: adding the RDS master secret, a wildcard or any other secret
  # to the secrets statement, or a second statement with secretsmanager actions.
  assert {
    condition = (
      toset(flatten([
        for st in jsondecode(aws_iam_role_policy.brain.policy).Statement : st.Resource
        if anytrue([for a in flatten([st.Action]) : startswith(a, "secretsmanager:")])
        ])) == toset([
        "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/app-db-password-mock",
        "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/origin-verify-mock",
        "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/resend-api-key-59egrs*",
      ]) &&
      alltrue([
        for st in jsondecode(aws_iam_role_policy.brain.policy).Statement :
        flatten([st.Action]) == ["secretsmanager:GetSecretValue"]
        if anytrue([for a in flatten([st.Action]) : startswith(a, "secretsmanager:")])
      ])
    )
    error_message = "The brain's role may read only the app database, origin-verify and Resend secrets."
  }

  # Mutation: giving the signals read statement Put/Delete, widening
  # SignalsWriteStatus past status.json, or any other statement on the
  # signals bucket lets the host (or a compromised API) change the release or
  # the serving switch that CI and Terraform decide.
  assert {
    condition = [
      for st in jsondecode(aws_iam_role_policy.brain.policy).Statement : [st.Sid, flatten([st.Action]), flatten([st.Resource])]
      if strcontains(jsonencode(st.Resource), "logjam-brain-signals")
      ] == [
      ["SignalsRead", ["s3:GetObject"], ["arn:aws:s3:::logjam-brain-signals-620853681701/release.json", "arn:aws:s3:::logjam-brain-signals-620853681701/serving"]],
      ["SignalsWriteStatus", ["s3:PutObject"], ["arn:aws:s3:::logjam-brain-signals-620853681701/status.json"]],
      ["SignalsList", ["s3:ListBucket"], ["arn:aws:s3:::logjam-brain-signals-620853681701"]],
    ]
    error_message = "The brain's role may read release.json and serving, list the signals bucket and write status.json: nothing else."
  }
}
