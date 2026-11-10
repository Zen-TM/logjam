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

# The brain runs choose a subnet by zone, which a mock would make up.
override_data {
  target = data.aws_subnet.worker_a
  values = { availability_zone = "ap-southeast-2a" }
}
override_data {
  target = data.aws_subnet.worker_b
  values = { availability_zone = "ap-southeast-2b" }
}

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

  # Mutation: widening the S3 resource (`/*`, the bucket, `status.json`) or
  # adding an action lets CI write more than the release pointer the brain
  # runs; adding another repository lets CI push images the brain pulls.
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

  # Mutation: dropping s3:ListBucketVersions or s3:GetObjectVersion from the
  # backup statements breaks point-in-time recovery (`--repo-target-time` gets a
  # 403 reading the versioned bucket); adding s3:DeleteObjectVersion,
  # s3:BypassGovernanceRetention or s3:PutObjectRetention (here or in any
  # statement) lets a compromised API weaken the lock on the backups.
  assert {
    condition = (
      length(setsubtract(["s3:ListBucketVersions", "s3:GetObjectVersion"], flatten([
        for st in jsondecode(aws_iam_role_policy.brain.policy).Statement : st.Action
        if strcontains(jsonencode(st.Resource), "logjam-brain-backups")
      ]))) == 0 &&
      length(setintersection(["s3:DeleteObjectVersion", "s3:BypassGovernanceRetention", "s3:PutObjectRetention", "s3:PutObjectLegalHold", "s3:PutBucketObjectLockConfiguration"], flatten([
        for st in jsondecode(aws_iam_role_policy.brain.policy).Statement : st.Action
      ]))) == 0
    )
    error_message = "The brain's role must list and read backup versions and must not delete versions or touch the lock."
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
  # signals bucket lets the host (or a compromised API) change the release that
  # CI decides.
  assert {
    condition = [
      for st in jsondecode(aws_iam_role_policy.brain.policy).Statement : [st.Sid, flatten([st.Action]), flatten([st.Resource])]
      if strcontains(jsonencode(st.Resource), "logjam-brain-signals")
      ] == [
      ["SignalsRead", ["s3:GetObject"], ["arn:aws:s3:::logjam-brain-signals-620853681701/release.json"]],
      ["SignalsWriteStatus", ["s3:PutObject"], ["arn:aws:s3:::logjam-brain-signals-620853681701/status.json"]],
      ["SignalsList", ["s3:ListBucket"], ["arn:aws:s3:::logjam-brain-signals-620853681701"]],
    ]
    error_message = "The brain's role may read release.json, list the signals bucket and write status.json: nothing else."
  }
}

# ── The brain's instance (brain_instance.tf, brain_alarms.tf) ────────────────

# A plan leaves a new resource's computed values unknown, and the user data is
# built from some of them. These overrides stand in for what AWS would assign,
# so the user data renders in full.
override_resource {
  target          = aws_ebs_volume.brain_data["1"]
  values          = { id = "vol-0aaaaaaaaaaaaaaa1" }
  override_during = plan
}
override_resource {
  target          = aws_ebs_volume.brain_data["2"]
  values          = { id = "vol-0bbbbbbbbbbbbbbb2" }
  override_during = plan
}
override_resource {
  target          = aws_eip.brain
  values          = { public_dns = "ec2-203-0-113-7.ap-southeast-2.compute.amazonaws.com" }
  override_during = plan
}
override_resource {
  target          = aws_ecr_repository.brain_postgres
  values          = { repository_url = "620853681701.dkr.ecr.ap-southeast-2.amazonaws.com/logjam-brain-postgres" }
  override_during = plan
}
override_resource {
  target          = aws_ecr_repository.api
  values          = { repository_url = "620853681701.dkr.ecr.ap-southeast-2.amazonaws.com/logjam-api" }
  override_during = plan
}
# The topic is imported in monitoring.tf, which a mocked provider cannot do.
override_resource {
  target          = aws_sns_topic.alerts
  values          = { arn = "arn:aws:sns:ap-southeast-2:620853681701:logjam-alerts" }
  override_during = plan
}
# A computed attribute that is unset in the configuration is unknown in a plan;
# the empty string stands for "no key pair", and a `key_name` in the
# configuration replaces it.
override_resource {
  target          = aws_instance.brain
  values          = { key_name = "", id = "i-0123456789abcdef0" }
  override_during = plan
}

run "brain_is_absent_by_default" {
  command = plan
  plan_options {
    target = [
      aws_instance.brain,
      terraform_data.brain_volume,
      aws_ebs_volume.brain_data,
      aws_eip.brain,
      aws_eip_association.brain,
      aws_volume_attachment.brain_data,
      aws_cloudwatch_metric_alarm.brain_system_status_failed,
      aws_cloudwatch_metric_alarm.brain_instance_status_failed,
      aws_cloudwatch_metric_alarm.brain_cpu_credits_low,
      aws_cloudwatch_metric_alarm.brain_cpu_surplus_credits_charged,
    ]
  }

  # Mutation: a non-empty default for brain_pg_image_tag, or taking the count
  # off any of these resources, makes merging the change start paying for an
  # instance, a volume or an address before anyone asked for one.
  assert {
    condition = (
      length(aws_instance.brain) == 0 &&
      length(terraform_data.brain_volume) == 0 &&
      length(aws_ebs_volume.brain_data) == 0 &&
      length(aws_eip.brain) == 0 &&
      length(aws_eip_association.brain) == 0 &&
      length(aws_volume_attachment.brain_data) == 0 &&
      length(aws_cloudwatch_metric_alarm.brain_system_status_failed) == 0 &&
      length(aws_cloudwatch_metric_alarm.brain_instance_status_failed) == 0 &&
      length(aws_cloudwatch_metric_alarm.brain_cpu_credits_low) == 0 &&
      length(aws_cloudwatch_metric_alarm.brain_cpu_surplus_credits_charged) == 0
    )
    error_message = "With the default variables the brain must have no instance, volume, address or alarm."
  }
}

run "brain_instance_is_locked_down" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [aws_instance.brain]
  }

  # Mutation: http_tokens = "optional" (IMDSv1 reachable from the API
  # container), a hop limit of 3 or more (a container behind another proxy
  # reaches the role credentials), instance_metadata_tags = "disabled" (the host
  # cannot read its switches and stays off), key_name set (a key pair is a
  # login nobody audits), disable_api_termination = true (the provider cannot
  # replace a protected instance: it stops the host, detaches the volume, then
  # fails), or an unencrypted root disk.
  assert {
    condition = (
      aws_instance.brain[0].metadata_options[0].http_tokens == "required" &&
      aws_instance.brain[0].metadata_options[0].http_endpoint == "enabled" &&
      aws_instance.brain[0].metadata_options[0].http_put_response_hop_limit <= 2 &&
      aws_instance.brain[0].metadata_options[0].instance_metadata_tags == "enabled" &&
      aws_instance.brain[0].key_name == "" &&
      aws_instance.brain[0].disable_api_termination == false &&
      aws_instance.brain[0].root_block_device[0].encrypted == true &&
      aws_instance.brain[0].associate_public_ip_address == true
    )
    error_message = "The brain must require IMDSv2 with a hop limit of at most 2, expose instance tags, have no key pair, no termination protection, and an encrypted root disk."
  }

  # Mutation: removing user_data_replace_on_change, or setting it false, leaves
  # a host-file change unapplied: the running instance keeps its old scripts
  # and the plan shows nothing.
  assert {
    condition     = aws_instance.brain[0].user_data_replace_on_change == true
    error_message = "A change to the user data must replace the brain's instance."
  }
}

run "brain_only_the_current_volume_is_attached_in_its_zone" {
  command = plan
  variables {
    brain_pg_image_tag        = "test"
    brain_data_volumes        = { "1" = { az = "ap-southeast-2a", size_gb = 20 }, "2" = { az = "ap-southeast-2b", size_gb = 20 } }
    brain_data_volume_current = "2"
  }
  plan_options {
    target = [aws_volume_attachment.brain_data]
  }

  # Mutation: attaching `["1"]` (the old disk) or attaching every volume
  # (a for_each, or a count of 2) mounts the wrong database or two; choosing the
  # subnet by anything but the current volume's zone leaves the instance in a
  # zone its disk cannot attach in; dropping stop_instance_before_detaching lets
  # a replacement pull the disk from under a running Postgres.
  assert {
    condition = (
      length(aws_ebs_volume.brain_data) == 2 &&
      length(aws_volume_attachment.brain_data) == 1 &&
      aws_volume_attachment.brain_data[0].volume_id == "vol-0bbbbbbbbbbbbbbb2" &&
      aws_volume_attachment.brain_data[0].stop_instance_before_detaching == true &&
      aws_instance.brain[0].subnet_id == data.aws_subnet.worker_b.id
    )
    error_message = "Only the current data volume may be attached, in its zone, and only after the OS has stopped."
  }
}

run "brain_data_volume_and_address_keep_prevent_destroy" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [aws_ebs_volume.brain_data, aws_eip.brain]
  }

  # A plan cannot show a lifecycle rule, and a mocked apply could not tear its
  # resources down again, so this reads the source: each block must hold
  # `prevent_destroy = true`. Mutation: removing it from either resource (the
  # data volume holds the only copy of the database between backups; the
  # address's DNS name is in the database certificate and every client's config).
  assert {
    condition = length(aws_eip.brain) == 1 && alltrue([
      for r in ["aws_ebs_volume\" \"brain_data", "aws_eip\" \"brain"] :
      can(regex("(?s)resource \"${r}\" \\{.*?\n\\}\n", file("brain_instance.tf"))) &&
      strcontains(regex("(?s)resource \"${r}\" \\{.*?\n\\}\n", file("brain_instance.tf")), "prevent_destroy = true")
    ])
    error_message = "The brain's data volume and Elastic IP must keep prevent_destroy (brain_instance.tf)."
  }
}

run "brain_host_files_leave_out_the_committed_certificate" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [aws_instance.brain]
  }

  # brain-ca.pem is committed after the first boot. If it were embedded, that
  # commit would change the user data and replace the instance. api.env is in
  # the tree, so the second line shows the filter itself works.
  # Mutation: taking "brain-ca.pem" out of local.brain_not_embedded, or the
  # `!contains(local.brain_not_embedded, f)` clause out of brain_host_file_set.
  assert {
    condition = (
      contains(local.brain_not_embedded, "brain-ca.pem") &&
      alltrue([for f in local.brain_not_embedded : !contains(local.brain_host_file_set, f)])
    )
    error_message = "brain-ca.pem must not be embedded in the user data: committing it would replace the instance."
  }
}

run "brain_instance_is_replaced_when_the_current_volume_changes" {
  command = plan
  variables {
    brain_pg_image_tag        = "test"
    brain_data_volumes        = { "1" = { az = "ap-southeast-2a", size_gb = 20 }, "2" = { az = "ap-southeast-2b", size_gb = 20 } }
    brain_data_volume_current = "2"
  }
  plan_options {
    target = [terraform_data.brain_volume]
  }

  # A mocked provider cannot show the replacement (a plan has no state to
  # replace, and an assertion cannot read an action), so this reads the two
  # halves from the source and the plan: the key follows the current volume,
  # and the instance names it. Without them "add volume N, make it current"
  # plans an in-place update (the new volume's id is unknown until it exists),
  # fails halfway and leaves the host stopped; a scratch rehearsal showed it.
  # Mutation: removing `replace_triggered_by` from the instance, or keying
  # terraform_data.brain_volume on anything but brain_data_volume_current.
  assert {
    condition = (
      terraform_data.brain_volume[0].triggers_replace == "2" &&
      strcontains(regex("(?s)resource \"aws_instance\" \"brain\" \\{.*?\n\\}\n", file("brain_instance.tf")), "replace_triggered_by = [terraform_data.brain_volume]")
    )
    error_message = "Changing brain_data_volume_current must replace the instance at plan time: terraform_data.brain_volume keyed on it, named in the instance's replace_triggered_by."
  }
}

run "brain_user_data_stays_within_the_ec2_limit" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [aws_instance.brain]
  }

  # Mutation: padding any host file with incompressible text (for example 8 KB
  # of `head -c 6000 /dev/urandom | base64` appended to host/lib.sh). EC2 refuses
  # user data over 16,384 bytes at launch, which is too late and too far from
  # the cause; this fails the plan at 15,000. If the files outgrow it, they move
  # into the brain image.
  assert {
    # The gzip bytes are not text, so the size is read off the base64 (4 characters per 3 bytes).
    condition     = length(aws_instance.brain[0].user_data_base64) * 3 / 4 < 15000
    error_message = "The brain's gzipped user data is 15,000 bytes or more: EC2's limit is 16,384 (brain_instance.tf says what to do)."
  }
}

run "brain_host_files_embed_cleanly_and_hold_no_secret" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [aws_instance.brain]
  }

  # The two checks are preconditions of aws_instance.brain, which run against
  # the same list of files the user data embeds, so every run that plans the
  # instance errors when one fails (the first of them is red, the rest skip).
  # Mutation: a line `BRAIN_HOST_FILE_EOF` in any file under infra/brain/
  # that is embedded (it would end its heredoc early and run the rest as root
  # on the instance); an access key id (AKIA...), a private key block or an
  # `aws_secret_access_key=<value>` line in one of them, in the user-data
  # template or in brain.env (the user data is readable by anyone who can
  # describe the instance, CI's read-only roles included).
  assert {
    condition     = length(aws_instance.brain) == 1
    error_message = "The brain's instance must plan: a host file holds the heredoc delimiter or a secret-shaped value (see the precondition errors above)."
  }
}

run "brain_names_the_image_by_the_immutable_tag" {
  command = plan
  variables {
    brain_pg_image_tag = "abc1234"
  }
  plan_options {
    target = [aws_instance.brain]
  }

  # Mutation: a literal `:latest` (or a branch name) in BRAIN_PG_IMAGE, or a
  # second `docker pull`, `create` or `run` in the user data that names another
  # image. A moving tag lets a restart or a replacement run a different
  # Postgres than the one reviewed.
  assert {
    condition = (
      output.brain_host_env["BRAIN_PG_IMAGE"] == "620853681701.dkr.ecr.ap-southeast-2.amazonaws.com/logjam-brain-postgres:abc1234" &&
      length(regexall("docker (pull|create|run) ", file("brain_user_data.sh.tftpl"))) == 1 &&
      strcontains(file("brain_user_data.sh.tftpl"), "docker create '$${pg_image}'")
    )
    error_message = "The brain's user data must pull only the Postgres image named by brain_pg_image_tag."
  }
}

run "brain_env_is_plain_key_value_the_host_files_read" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [aws_instance.brain]
  }

  # The files that read the keys are the host scripts and the Compose files.
  # Mutation: renaming a key (BRAIN_SIGNALS_BUCKET to BRAIN_SIGNAL_BUCKET) or
  # dropping one in brain_instance.tf, or the same in the host files: lib.sh
  # and Compose (`${KEY:?}`) refuse to start without a key the host needs,
  # and a key nothing reads is a typo. Two lists that must agree.
  assert {
    condition = (
      toset(flatten([
        for f in setunion(fileset("../../../brain", "host/*.sh"), fileset("../../../brain", "compose*.yaml")) :
        [for m in regexall("\\$\\{([A-Z][A-Z0-9_]*):\\?", file("../../../brain/${f}")) : m[0]]
      ])) == setsubtract(toset(keys(output.brain_host_env)), ["BRAIN_PG_FLAGS", "BRAIN_API_MEM_LIMIT"]) &&
      alltrue([
        for k in keys(output.brain_host_env) : anytrue([
          for f in setunion(fileset("../../../brain", "host/*.sh"), fileset("../../../brain", "compose*.yaml")) : strcontains(file("../../../brain/${f}"), k)
        ])
      ])
    )
    error_message = "brain.env must hold exactly the keys the host scripts and Compose require, plus the optional BRAIN_PG_FLAGS and BRAIN_API_MEM_LIMIT."
  }

  # Mutation: quoting a value or putting a newline in one. lib.sh reads
  # the file line by line as KEY=value and does not unquote.
  assert {
    condition = alltrue([
      for v in values(output.brain_host_env) : !can(regex("[\"'\\n]", v)) && v != ""
    ])
    error_message = "brain.env values must be unquoted, single-line and non-empty."
  }

  # Mutation: a memory setting for another size, or the flags not following
  # brain_instance_type.
  assert {
    condition     = output.brain_host_env["BRAIN_PG_FLAGS"] == "-c shared_buffers=512MB -c effective_cache_size=1GB" && output.brain_host_env["BRAIN_API_MEM_LIMIT"] == "768m"
    error_message = "A t4g.small must run Postgres with shared_buffers=512MB and effective_cache_size=1GB and the API with a 768m limit."
  }

  # Mutation: the by-id path built from anything but the current volume's id.
  assert {
    condition     = output.brain_host_env["BRAIN_DATA_DEVICE"] == "/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_vol0aaaaaaaaaaaaaaa1"
    error_message = "BRAIN_DATA_DEVICE must be the current data volume's by-id path (the id without its dash)."
  }
  assert {
    condition     = output.brain_host_env["BRAIN_TLS_SANS"] == "ec2-203-0-113-7.ap-southeast-2.compute.amazonaws.com,postgres,localhost"
    error_message = "BRAIN_TLS_SANS must be the Elastic IP's DNS name, postgres and localhost."
  }
}

run "brain_switches_are_in_place_tags_first" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
    brain_serving      = false
    brain_bootstrap    = false
  }
  plan_options {
    target = [aws_instance.brain]
  }
  assert {
    condition     = aws_instance.brain[0].tags["brain-serving"] == "off" && aws_instance.brain[0].tags["brain-bootstrap"] == "0"
    error_message = "The switches are off by default."
  }
}

run "brain_switches_are_in_place_tags" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
    brain_serving      = true
    brain_bootstrap    = true
  }
  plan_options {
    target = [aws_instance.brain]
  }

  # Mutation: using var.brain_serving or var.brain_bootstrap anywhere in the
  # user data or brain.env (for example a BRAIN_SERVING key). The instance is
  # replaced when its user data changes, so flipping a switch would stop the
  # database host instead of updating a tag. A tag changes in place.
  assert {
    condition = (
      aws_instance.brain[0].tags["brain-serving"] == "on" &&
      aws_instance.brain[0].tags["brain-bootstrap"] == "1" &&
      output.brain_user_data_sha256 == run.brain_switches_are_in_place_tags_first.brain_user_data_sha256
    )
    error_message = "Flipping brain_serving or brain_bootstrap must change only the instance's tags, never its user data."
  }
}

run "brain_instance_type_needs_memory_settings" {
  command = plan
  variables {
    brain_instance_type = "t3.micro"
  }
  plan_options {
    target = [aws_instance.brain]
  }

  # Mutation: removing the variable's validation. A type without memory
  # settings would otherwise fail only once an instance is wanted, or run with
  # Postgres's 128 MB defaults.
  expect_failures = [var.brain_instance_type]
}

run "brain_alarms_act_on_the_instance" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
    brain_cpu_credits  = "standard"
  }
  plan_options {
    target = [
      aws_cloudwatch_metric_alarm.brain_system_status_failed,
      aws_cloudwatch_metric_alarm.brain_instance_status_failed,
      aws_cloudwatch_metric_alarm.brain_cpu_credits_low,
      aws_cloudwatch_metric_alarm.brain_cpu_surplus_credits_charged,
    ]
  }

  # Mutation: swapping the two actions (a failed system check would reboot a
  # host that needs moving, a failed instance check would "recover" one that
  # needs a reboot), dropping the topic from either, another dimension, or an
  # alarm description without its "First:" step (alarms.md says each email
  # repeats it).
  assert {
    condition = (
      aws_cloudwatch_metric_alarm.brain_system_status_failed[0].metric_name == "StatusCheckFailed_System" &&
      toset(aws_cloudwatch_metric_alarm.brain_system_status_failed[0].alarm_actions) == toset(["arn:aws:automate:ap-southeast-2:ec2:recover", aws_sns_topic.alerts.arn]) &&
      aws_cloudwatch_metric_alarm.brain_instance_status_failed[0].metric_name == "StatusCheckFailed_Instance" &&
      toset(aws_cloudwatch_metric_alarm.brain_instance_status_failed[0].alarm_actions) == toset(["arn:aws:automate:ap-southeast-2:ec2:reboot", aws_sns_topic.alerts.arn]) &&
      alltrue([
        for a in [aws_cloudwatch_metric_alarm.brain_system_status_failed[0], aws_cloudwatch_metric_alarm.brain_instance_status_failed[0], aws_cloudwatch_metric_alarm.brain_cpu_credits_low[0]] :
        a.dimensions["InstanceId"] == aws_instance.brain[0].id && length(a.dimensions) == 1 && strcontains(a.alarm_description, "First: ")
      ])
    )
    error_message = "The status-check alarms must recover (system) and reboot (instance) this instance and tell the topic, and each says what to do first."
  }

  # Mutation: dropping the credit-mode condition. Standard mode watches the
  # balance; unlimited mode (the default, next run) watches the surplus charge.
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.brain_cpu_credits_low) == 1 && length(aws_cloudwatch_metric_alarm.brain_cpu_surplus_credits_charged) == 0
    error_message = "Standard credit mode must have the low-balance alarm and not the surplus alarm."
  }
}

run "brain_credit_mode_defaults_to_unlimited_and_alarms_the_surplus" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [
      aws_instance.brain,
      aws_cloudwatch_metric_alarm.brain_cpu_credits_low,
      aws_cloudwatch_metric_alarm.brain_cpu_surplus_credits_charged,
    ]
  }

  # Mutation: the variable's default going back to "standard" (unlimited is
  # the maintainer's choice), or the surplus alarm not following the mode. A
  # surplus charge shows on the bill only, so the alarm is how it is noticed.
  assert {
    condition = (
      aws_instance.brain[0].credit_specification[0].cpu_credits == "unlimited" &&
      length(aws_cloudwatch_metric_alarm.brain_cpu_credits_low) == 0 &&
      length(aws_cloudwatch_metric_alarm.brain_cpu_surplus_credits_charged) == 1 &&
      strcontains(aws_cloudwatch_metric_alarm.brain_cpu_surplus_credits_charged[0].alarm_description, "First: ")
    )
    error_message = "The brain's credit mode must default to unlimited, with the surplus alarm and no low-balance alarm."
  }
}

run "brain_instance_sizes_set_postgres_and_api_memory" {
  command = plan
  variables {
    brain_pg_image_tag  = "test"
    brain_instance_type = "t4g.micro"
  }
  plan_options {
    target = [aws_instance.brain]
  }

  # Mutation: a different number for a size in local.brain_pg_memory, or the
  # API limit not following the instance type. Small's values are asserted in
  # brain_env_is_plain_key_value_the_host_files_read.
  assert {
    condition = (
      output.brain_host_env["BRAIN_PG_FLAGS"] == "-c shared_buffers=128MB -c effective_cache_size=256MB" &&
      output.brain_host_env["BRAIN_API_MEM_LIMIT"] == "384m"
    )
    error_message = "A t4g.micro must run Postgres with shared_buffers=128MB and effective_cache_size=256MB and the API with a 384m limit."
  }
}

# ── The cutover's data copy (brain_copy.tf) ──────────────────────────────────

run "brain_copy_is_absent_by_default" {
  command = plan
  plan_options {
    target = [
      aws_ecs_task_definition.brain_copy,
      aws_iam_role.brain_copy,
      aws_iam_role_policy.brain_copy,
      aws_cloudwatch_log_group.brain_copy,
    ]
  }

  # Mutation: taking the count off any of these resources, so merging the
  # change registers a task definition (and a role) before the brain exists.
  assert {
    condition = (
      length(aws_ecs_task_definition.brain_copy) == 0 &&
      length(aws_iam_role.brain_copy) == 0 &&
      length(aws_iam_role_policy.brain_copy) == 0 &&
      length(aws_cloudwatch_log_group.brain_copy) == 0
    )
    error_message = "With the default variables the data copy must have no task definition, role or log group."
  }
}

run "brain_copy_task_reads_only_status_json" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [aws_ecs_task_definition.brain_copy, aws_iam_role_policy.brain_copy]
  }

  override_resource {
    target          = aws_s3_bucket.brain_signals
    values          = { arn = "arn:aws:s3:::logjam-brain-signals-mock" }
    override_during = plan
  }
  override_resource {
    target = aws_db_instance.main
    values = {
      address            = "logjam-db-enc.example.ap-southeast-2.rds.amazonaws.com"
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:rds-mock", kms_key_id = "", secret_status = "active" }]
    }
    override_during = plan
  }
  override_resource {
    target          = aws_iam_role.brain_copy
    values          = { arn = "arn:aws:iam::620853681701:role/logjam-brain-copy" }
    override_during = plan
  }
  override_resource {
    target          = aws_iam_role.ecs_task_execution
    values          = { arn = "arn:aws:iam::620853681701:role/ecsTaskExecutionRole" }
    override_during = plan
  }
  override_resource {
    target          = aws_secretsmanager_secret.app_db
    values          = { arn = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/app-db-password-mock" }
    override_during = plan
  }

  # Mutation: any second statement or action on the task role, a wider
  # resource than status.json (the signals bucket also holds release.json,
  # which the copy has no business reading), or a credential given to the
  # task as plain environment. The role is what makes "the copy reads one
  # file and writes nothing" true.
  assert {
    condition = (
      length(jsondecode(aws_iam_role_policy.brain_copy[0].policy).Statement) == 1 &&
      jsondecode(aws_iam_role_policy.brain_copy[0].policy).Statement[0].Effect == "Allow" &&
      jsondecode(aws_iam_role_policy.brain_copy[0].policy).Statement[0].Action == "s3:GetObject" &&
      jsondecode(aws_iam_role_policy.brain_copy[0].policy).Statement[0].Resource == "arn:aws:s3:::logjam-brain-signals-mock/status.json"
    )
    error_message = "The data copy's task role may read status.json and nothing else."
  }

  # Mutation: another command or architecture, the brain's name taken from
  # anywhere but the Elastic IP, or a key in the plain environment.
  assert {
    condition = (
      aws_ecs_task_definition.brain_copy[0].runtime_platform[0].cpu_architecture == "ARM64" &&
      jsondecode(aws_ecs_task_definition.brain_copy[0].container_definitions)[0].command == ["/usr/local/lib/brain/copy.sh"] &&
      endswith(jsondecode(aws_ecs_task_definition.brain_copy[0].container_definitions)[0].image, "/logjam-brain-postgres:test") &&
      alltrue([for e in jsondecode(aws_ecs_task_definition.brain_copy[0].container_definitions)[0].environment : !can(regex("(?i)password|secret|key|token", e.name))]) &&
      [for e in jsondecode(aws_ecs_task_definition.brain_copy[0].container_definitions)[0].environment : e.value if e.name == "COPY_TARGET_HOST"][0] == "ec2-203-0-113-7.ap-southeast-2.compute.amazonaws.com" &&
      [for e in jsondecode(aws_ecs_task_definition.brain_copy[0].container_definitions)[0].environment : e.value if e.name == "COPY_SOURCE_HOST"][0] == "logjam-db-enc.example.ap-southeast-2.rds.amazonaws.com"
    )
    error_message = "The data copy must run copy.sh on ARM64 from the brain's image, between RDS and the brain's own name, with no credential in its environment."
  }

  # Without infra/brain/brain-ca.pem (committed once the brain has booted) the
  # task still plans, with an empty CA, and the script refuses. Mutation:
  # reading the file without the fileexists guard (the plan errors).
  assert {
    condition     = [for e in jsondecode(aws_ecs_task_definition.brain_copy[0].container_definitions)[0].environment : e.value if e.name == "COPY_TARGET_CA"][0] == ""
    error_message = "Until brain-ca.pem exists the data copy's CA must be empty."
  }
}

run "brain_copy_is_never_scheduled" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [aws_ecs_task_definition.brain_copy]
  }
  override_resource {
    target = aws_db_instance.main
    values = {
      address            = "logjam-db-enc.example.ap-southeast-2.rds.amazonaws.com"
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:rds-mock", kms_key_id = "", secret_status = "active" }]
    }
    override_during = plan
  }

  # Nothing may start the task but a person. A plan cannot list the
  # schedules that name it, so this reads every .tf file: no other file may
  # mention the task definition, and brain_copy.tf holds no schedule, event
  # rule or pipe. Mutation: an aws_scheduler_schedule (or event target) in any
  # file naming aws_ecs_task_definition.brain_copy, or one added to
  # brain_copy.tf. A copy run after the cutover replaces the live database
  # with RDS's frozen copy.
  assert {
    condition = (
      length(aws_ecs_task_definition.brain_copy) == 1 &&
      alltrue([for f in setunion(fileset(".", "*.tf")) : f == "brain_copy.tf" || !strcontains(file(f), "aws_ecs_task_definition.brain_copy")]) &&
      !can(regex("aws_scheduler|aws_cloudwatch_event|aws_pipes|aws_batch", file("brain_copy.tf")))
    )
    error_message = "The data copy must have no schedule: only a person starts it (brain_copy.tf)."
  }
}
