# terraform -chdir=infra/terraform/envs/prod test   (offline: mocked providers)
#
# Who may assume the CI roles, and what Terraform reads back. Each assert
# names the mutation that turns it red. Each run plans only the resources it
# asserts on: a mocked provider cannot import, or refresh every resource here.
# A targeted plan validates only the variables its targets read, so a run with
# expect_failures on a variable targets a resource that uses that variable.

mock_provider "aws" {}
mock_provider "aws" {
  alias = "us_east_1"
}
mock_provider "random" {}
mock_provider "archive" {}

# terraform test loads *.auto.tfvars from the root, so brain.auto.tfvars (prod's
# switches, edited at the cutover) would otherwise decide what every run
# plans. These pin every setting that file carries to the dormant values, so
# the suite says the same whatever the file says; a run that needs another
# value sets it in its own variables block, which wins over this one. Guard:
# brain_settings_are_one_file_and_read_by_the_workflows (it reads the file
# and fails if a setting here is missing).
variables {
  brain_pg_image_tag        = ""
  brain_bootstrap           = false
  brain_serving             = false
  brain_public              = false
  brain_instance_type       = "t4g.small"
  brain_data_volumes        = { "1" = { az = "ap-southeast-2a", size_gb = 20 } }
  brain_data_volume_current = "1"
}
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

  # Mutation: removing the DenySnapshotBlocks or the DenyCommandOutput
  # statement (or one action in it) lets the read-only roles read a disk
  # snapshot block by block, or the output of a command run on the brain.
  assert {
    condition = alltrue([
      for a in [
        "ebs:GetSnapshotBlock", "ebs:ListSnapshotBlocks", "ebs:ListChangedBlocks",
        "ssm:GetCommandInvocation", "ssm:ListCommandInvocations", "ssm:ListCommands",
        ] : anytrue([
          for st in jsondecode(aws_iam_role_policy.gha_plan_readonly_privacy_deny.policy).Statement :
          st.Effect == "Deny" && st.Resource == "*" && contains(flatten([st.Action]), a)
      ])
    ])
    error_message = "The CI privacy Deny must cover EBS direct snapshot reads and Run Command output (local.ci_readonly_privacy_deny)."
  }

  # Mutation: removing the DenyShells statement (or one action in it), or
  # filtering it out of the boundary in iam_apply.tf, lets a CI role, the
  # apply role above all, open a shell on the brain or in a task.
  assert {
    condition = alltrue([
      for p in [
        aws_iam_role_policy.gha_plan_readonly_privacy_deny.policy,
        aws_iam_role_policy.gha_readonly_privacy_deny.policy,
        aws_iam_policy.github_actions_apply_boundary.policy,
        ] : alltrue([
          for a in ["ssm:SendCommand", "ssm:StartSession", "ssm:ResumeSession", "ecs:ExecuteCommand"] : anytrue([
            for st in jsondecode(p).Statement :
            st.Effect == "Deny" && st.Resource == "*" && contains(flatten([st.Action]), a)
          ])
      ])
    ])
    error_message = "The CI privacy Deny, and the apply role's boundary, must deny shells on instances and in tasks (local.ci_readonly_privacy_deny)."
  }
}

run "audit_trail_records_every_route_to_user_data" {
  command = plan
  plan_options {
    target = [aws_cloudtrail.audit]
  }

  # Each selector as a map of its fields, by field name.
  # Mutation: dropping the management selector, or giving it a readOnly
  # field, leaves a snapshot export or a session start unrecorded.
  assert {
    condition = anytrue([
      for sel in aws_cloudtrail.audit.advanced_event_selector :
      toset({ for f in sel.field_selector : f.field => f }["eventCategory"].equals) == toset(["Management"]) &&
      length(sel.field_selector) == 1
    ])
    error_message = "The audit trail must record all management events."
  }

  # Mutation: dropping the media and topo selector, or narrowing it to writes
  # only (a readOnly field), leaves reads of users' files unrecorded. Dropping
  # the eventCategory = Data field from this or the next two selectors is also
  # red here: CloudTrail rejects such a selector, and that would otherwise
  # show only when the maintainer applies it.
  assert {
    condition = anytrue([
      for sel in aws_cloudtrail.audit.advanced_event_selector : (
        try(toset({ for f in sel.field_selector : f.field => f }["eventCategory"].equals) == toset(["Data"]), false) &&
        toset({ for f in sel.field_selector : f.field => f }["resources.type"].equals) == toset(["AWS::S3::Object"]) &&
        !contains([for f in sel.field_selector : f.field], "readOnly") &&
        toset({ for f in sel.field_selector : f.field => f }["resources.ARN"].starts_with) == toset(["arn:aws:s3:::logjam-media/", "arn:aws:s3:::logjam-topo-jobs/"])
      )
      if contains([for f in sel.field_selector : f.field], "resources.type") && contains([for f in sel.field_selector : f.field], "resources.ARN")
    ])
    error_message = "The audit trail must record object reads and writes in the media and topo buckets."
  }

  # Mutation: dropping the backup selector, or turning its readOnly value to
  # "false", leaves a GetObject of the database's backups unrecorded.
  assert {
    condition = anytrue([
      for sel in aws_cloudtrail.audit.advanced_event_selector : (
        try(toset({ for f in sel.field_selector : f.field => f }["eventCategory"].equals) == toset(["Data"]), false) &&
        toset({ for f in sel.field_selector : f.field => f }["resources.type"].equals) == toset(["AWS::S3::Object"]) &&
        toset({ for f in sel.field_selector : f.field => f }["readOnly"].equals) == toset(["true"]) &&
        toset({ for f in sel.field_selector : f.field => f }["resources.ARN"].starts_with) == toset(["arn:aws:s3:::${local.brain_backups_bucket}/"])
      )
      if alltrue([for k in ["resources.type", "readOnly", "resources.ARN"] : contains([for f in sel.field_selector : f.field], k)])
    ])
    error_message = "The audit trail must record object reads in the brain's backup bucket."
  }

  # Mutation: dropping the EBS selector leaves a disk snapshot's block reads
  # unrecorded; a readOnly field would drop its writes.
  assert {
    condition = anytrue([
      for sel in aws_cloudtrail.audit.advanced_event_selector : (
        try(toset({ for f in sel.field_selector : f.field => f }["eventCategory"].equals) == toset(["Data"]), false) &&
        toset({ for f in sel.field_selector : f.field => f }["resources.type"].equals) == toset(["AWS::EC2::Snapshot"]) &&
        !contains([for f in sel.field_selector : f.field], "readOnly")
      )
      if contains([for f in sel.field_selector : f.field], "resources.type")
    ])
    error_message = "The audit trail must record EBS direct API calls on snapshots."
  }

  # Mutation: a selector on every S3 object (no resources.ARN field, or an
  # ARN prefix such as "arn:aws:s3:::") makes the trail log its own bucket's
  # deliveries, an endless loop of events.
  assert {
    condition = alltrue([
      for sel in aws_cloudtrail.audit.advanced_event_selector : (
        contains([for f in sel.field_selector : f.field], "resources.ARN") &&
        !anytrue([
          for v in try({ for f in sel.field_selector : f.field => f }["resources.ARN"].starts_with, []) :
          startswith("arn:aws:s3:::logjam-audit-${local.account_id}/AWSLogs/x", v)
        ])
      )
      if anytrue([for f in sel.field_selector : f.field == "resources.type" && try(contains(f.equals, "AWS::S3::Object"), false)])
    ])
    error_message = "The audit trail must never record the audit bucket's own objects."
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
      aws_iam_role_policy_attachment.brain_ssm,
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

  # Mutation: a second inline policy by hand in Terraform, dropping the
  # exclusive inline resource, or pointing the one managed attachment at a
  # broader policy (CloudWatchFullAccess, a revived AmazonS3FullAccess), widens
  # a role the whole API runs as. Re-adding exclusive management of the role's
  # managed attachments lifts the cost-ceiling deny at the next apply: AWS
  # Budgets attaches that deny to this role, and an exclusive resource would
  # detach it (brain_iam.tf).
  assert {
    condition = (
      aws_iam_role_policy_attachment.brain_ssm.policy_arn == "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore" &&
      toset(aws_iam_role_policies_exclusive.brain.policy_names) == toset([aws_iam_role_policy.brain.name]) &&
      !strcontains(file("brain_iam.tf"), "aws_iam_role_policy_attachments_exclusive")
    )
    error_message = "The brain's role may hold only the Session Manager policy and its one inline policy; its managed attachments must not be exclusive, or an apply lifts the cost-ceiling deny."
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
      aws_cloudwatch_metric_alarm.brain_cpu_high,
    ]
  }

  # Mutation: taking the count off any of these resources, makes merging the
  # change start paying for an instance, a volume or an address before anyone
  # asked for one. The variables' own defaults are guarded by
  # brain_variable_defaults_are_inert: this file pins the settings, so a
  # default changed here would not show.
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
      length(aws_cloudwatch_metric_alarm.brain_cpu_high) == 0
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
  # The certificate is not in the tree yet, so the last line reads the filter
  # itself: without it, a filter that names only api.env would leave this test
  # failing on an unknown value, not on its message.
  assert {
    condition = (
      contains(local.brain_not_embedded, "brain-ca.pem") &&
      alltrue([for f in local.brain_not_embedded : !contains(local.brain_host_file_set, f)]) &&
      strcontains(file("brain_instance.tf"), "!contains(local.brain_not_embedded, f)")
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
      ])) == setsubtract(toset(keys(output.brain_host_env)), ["BRAIN_PG_FLAGS", "BRAIN_API_MEM_LIMIT", "BRAIN_RESTORE_TARGET"]) &&
      alltrue([
        for k in keys(output.brain_host_env) : anytrue([
          for f in setunion(fileset("../../../brain", "host/*.sh"), fileset("../../../brain", "compose*.yaml")) : strcontains(file("../../../brain/${f}"), k)
        ])
      ])
    )
    error_message = "brain.env must hold exactly the keys the host scripts and Compose require, plus the optional BRAIN_PG_FLAGS, BRAIN_API_MEM_LIMIT and BRAIN_RESTORE_TARGET."
  }

  # Mutation: quoting a value or putting a newline in one. lib.sh reads
  # the file line by line as KEY=value and does not unquote.
  assert {
    condition = alltrue([
      for k, v in output.brain_host_env : !can(regex("[\"'\\n]", v)) && (v != "" || k == "BRAIN_RESTORE_TARGET")
    ])
    error_message = "brain.env values must be unquoted, single-line and non-empty (BRAIN_RESTORE_TARGET is empty unless the current volume has a restore_to)."
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

run "brain_restore_target_comes_only_from_the_current_volume" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
    brain_data_volumes = {
      "1" = { az = "ap-southeast-2a", size_gb = 20, restore_to = "2026-11-20T03:15:00+11:00" }
      "2" = { az = "ap-southeast-2a", size_gb = 20 }
    }
    brain_data_volume_current = "2"
  }
  plan_options {
    target = [aws_instance.brain]
  }

  # The target is the new volume's own: a later volume added without one gets
  # the latest state, however many earlier entries carry a time.
  # Mutation: reading restore_to from any entry (the first non-empty one, or
  # the key "1") instead of the current one.
  assert {
    condition     = output.brain_host_env["BRAIN_RESTORE_TARGET"] == ""
    error_message = "A time on an earlier volume's entry must not reach the host: only the current volume's restore_to does."
  }
}

run "brain_restore_target_reaches_the_host_from_the_current_volume" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
    brain_data_volumes = {
      "1" = { az = "ap-southeast-2a", size_gb = 20, restore_to = "2026-11-19T00:00:00Z" }
      "2" = { az = "ap-southeast-2a", size_gb = 20, restore_to = "2026-11-20T03:15:00.250+11:00" }
    }
    brain_data_volume_current = "2"
  }
  plan_options {
    target = [aws_instance.brain]
  }

  # Mutation: reading restore_to from any entry but the current one, or not
  # putting it in brain.env (the host then restores the latest state without a
  # word, which is the failure this feature exists to prevent).
  assert {
    condition     = output.brain_host_env["BRAIN_RESTORE_TARGET"] == "2026-11-20T03:15:00.250+11:00"
    error_message = "BRAIN_RESTORE_TARGET must be the current volume's restore_to."
  }
}

run "brain_restore_to_without_an_offset_is_refused" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
    brain_data_volumes = {
      "1" = { az = "ap-southeast-2a", size_gb = 20 }
      "2" = { az = "ap-southeast-2a", size_gb = 20, restore_to = "2026-11-20T03:15:00" }
    }
    brain_data_volume_current = "2"
  }

  plan_options {
    target = [aws_instance.brain]
  }

  # Mutation: deleting the validation, or both its halves at once (the offset
  # optional in the pattern, `timecmp` replaced by `true`): either half alone
  # still refuses a time with no offset. A time without a zone is read in the
  # host's.
  expect_failures = [var.brain_data_volumes]
}

run "brain_restore_to_must_be_a_real_time" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
    brain_data_volumes = {
      "1" = { az = "ap-southeast-2a", size_gb = 20, restore_to = "2026-13-45T25:61:00+11:00" }
    }
  }

  plan_options {
    target = [aws_instance.brain]
  }

  # Mutation: dropping the `timecmp` half of the validation (the pattern alone
  # accepts month 13).
  expect_failures = [var.brain_data_volumes]
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
      aws_cloudwatch_metric_alarm.brain_cpu_high,
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
        for a in [aws_cloudwatch_metric_alarm.brain_system_status_failed[0], aws_cloudwatch_metric_alarm.brain_instance_status_failed[0], aws_cloudwatch_metric_alarm.brain_cpu_credits_low[0], aws_cloudwatch_metric_alarm.brain_cpu_high[0]] :
        a.dimensions["InstanceId"] == aws_instance.brain[0].id && length(a.dimensions) == 1 && strcontains(a.alarm_description, "First: ")
      ])
    )
    error_message = "The status-check alarms must recover (system) and reboot (instance) this instance and tell the topic, and each says what to do first."
  }

  # Mutation: another metric, statistic, period, evaluation count or threshold
  # (20% over one hour is the whole of one alarm: a lower one pages on idle, a
  # higher one lets a month of surplus credits through unnoticed, and several
  # shorter readings that must all be high miss a load that rests between
  # bursts), missing
  # data breaching, or no topic.
  assert {
    condition = (
      aws_cloudwatch_metric_alarm.brain_cpu_high[0].namespace == "AWS/EC2" &&
      aws_cloudwatch_metric_alarm.brain_cpu_high[0].metric_name == "CPUUtilization" &&
      aws_cloudwatch_metric_alarm.brain_cpu_high[0].statistic == "Average" &&
      aws_cloudwatch_metric_alarm.brain_cpu_high[0].period == 3600 &&
      aws_cloudwatch_metric_alarm.brain_cpu_high[0].evaluation_periods == 1 &&
      aws_cloudwatch_metric_alarm.brain_cpu_high[0].threshold == 20 &&
      aws_cloudwatch_metric_alarm.brain_cpu_high[0].comparison_operator == "GreaterThanOrEqualToThreshold" &&
      aws_cloudwatch_metric_alarm.brain_cpu_high[0].treat_missing_data == "notBreaching" &&
      contains(aws_cloudwatch_metric_alarm.brain_cpu_high[0].alarm_actions, aws_sns_topic.alerts.arn)
    )
    error_message = "The CPU alarm must fire on one hour averaging 20% or more and tell the alerts topic."
  }

  # Mutation: dropping the credit-mode condition. Only standard mode can run
  # out of credits (unlimited mode, the default, next run, has none to alarm on).
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.brain_cpu_credits_low) == 1
    error_message = "Standard credit mode must have the low-balance alarm."
  }
}

run "brain_credit_mode_defaults_to_unlimited" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [
      aws_instance.brain,
      aws_cloudwatch_metric_alarm.brain_cpu_credits_low,
    ]
  }

  # Mutation: the variable's default going back to "standard" (unlimited is
  # the maintainer's choice), or the low-balance alarm existing without the
  # throttling it warns of.
  assert {
    condition = (
      aws_instance.brain[0].credit_specification[0].cpu_credits == "unlimited" &&
      length(aws_cloudwatch_metric_alarm.brain_cpu_credits_low) == 0
    )
    error_message = "The brain's credit mode must default to unlimited, with no low-balance alarm."
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

  # The names copy.sh reads (`${NAME:?}` or `${NAME:-...}`) and the task
  # definition's environment plus secrets are one list. The three optional
  # overrides are in the script only: the task never sets them, a person adds
  # them to a run (COPY_SOURCE_CA_FILE is for tests). Mutation: renaming
  # BRAIN_SIGNALS_BUCKET in brain_copy.tf (the task would stop at start, in
  # the cutover window), or reading a new name in copy.sh.
  assert {
    condition = (
      setsubtract(
        toset([for m in regexall("\\$\\{([A-Z][A-Z0-9_]*):[?-]", file("../../../brain/postgres/copy.sh")) : m[0]]),
        ["COPY_REPLACE", "COPY_ALLOW_LIVE_SOURCE", "COPY_SOURCE_CA_FILE"]
        ) == toset(concat(
          [for e in jsondecode(aws_ecs_task_definition.brain_copy[0].container_definitions)[0].environment : e.name],
          [for e in jsondecode(aws_ecs_task_definition.brain_copy[0].container_definitions)[0].secrets : e.name]
      ))
    )
    error_message = "copy.sh and the data copy's task definition must name the same environment variables."
  }

  # The task verifies the brain against infra/brain/brain-ca.pem, the
  # certificate the brain made at its first boot. Without the file (a new
  # environment, before its brain has booted) the task still plans, with an
  # empty CA, and the script refuses. Mutation: any other value for
  # COPY_TARGET_CA in brain_copy.tf; with the file absent, reading it without
  # the fileexists guard (the plan errors).
  assert {
    condition = (
      [for e in jsondecode(aws_ecs_task_definition.brain_copy[0].container_definitions)[0].environment : e.value if e.name == "COPY_TARGET_CA"][0] ==
      (fileexists("../../../brain/brain-ca.pem") ? file("../../../brain/brain-ca.pem") : "")
    )
    error_message = "The data copy's CA must be the text of infra/brain/brain-ca.pem, or empty until that file exists."
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

# ── The brain's watchdog and restore drill (brain_watchdog.tf, brain_drill.tf) ──

run "brain_watchdog_and_drill_are_absent_by_default" {
  command = plan
  plan_options {
    target = [
      aws_cloudwatch_log_group.brain_watchdog,
      aws_iam_role.brain_watchdog,
      aws_iam_role_policy.brain_watchdog,
      aws_lambda_function.brain_watchdog,
      aws_lambda_function_event_invoke_config.brain_watchdog,
      aws_cloudwatch_event_rule.brain_watchdog,
      aws_cloudwatch_event_target.brain_watchdog,
      aws_lambda_permission.brain_watchdog,
      aws_cloudwatch_metric_alarm.brain_watchdog_checks_failing,
      aws_cloudwatch_metric_alarm.brain_watchdog_dead,
      aws_cloudwatch_log_group.brain_drill,
      aws_security_group.brain_drill,
      aws_iam_role.brain_drill,
      aws_iam_role_policy.brain_drill,
      aws_ecs_task_definition.brain_drill,
      aws_iam_role.brain_drill_scheduler,
      aws_iam_role_policy.brain_drill_scheduler,
      aws_scheduler_schedule.brain_drill,
    ]
  }

  # Mutation: `count = 1` on any of these (or a non-empty default for
  # brain_pg_image_tag): merging would start a Lambda, a daily Fargate task and
  # two alarms for a brain that does not exist, and the watchdog's missing
  # status.json would page from the first run.
  assert {
    condition = alltrue([
      length(aws_cloudwatch_log_group.brain_watchdog) == 0,
      length(aws_iam_role.brain_watchdog) == 0,
      length(aws_iam_role_policy.brain_watchdog) == 0,
      length(aws_lambda_function.brain_watchdog) == 0,
      length(aws_lambda_function_event_invoke_config.brain_watchdog) == 0,
      length(aws_cloudwatch_event_rule.brain_watchdog) == 0,
      length(aws_cloudwatch_event_target.brain_watchdog) == 0,
      length(aws_lambda_permission.brain_watchdog) == 0,
      length(aws_cloudwatch_metric_alarm.brain_watchdog_checks_failing) == 0,
      length(aws_cloudwatch_metric_alarm.brain_watchdog_dead) == 0,
      length(aws_cloudwatch_log_group.brain_drill) == 0,
      length(aws_security_group.brain_drill) == 0,
      length(aws_iam_role.brain_drill) == 0,
      length(aws_iam_role_policy.brain_drill) == 0,
      length(aws_ecs_task_definition.brain_drill) == 0,
      length(aws_iam_role.brain_drill_scheduler) == 0,
      length(aws_iam_role_policy.brain_drill_scheduler) == 0,
      length(aws_scheduler_schedule.brain_drill) == 0,
    ])
    error_message = "With the default variables the watchdog and the restore drill must not exist."
  }
}

run "brain_watchdog_role_reads_only_the_signals" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [aws_iam_role_policy.brain_watchdog]
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
  override_resource {
    target          = aws_cloudwatch_log_group.brain_watchdog
    values          = { arn = "arn:aws:logs:ap-southeast-2:620853681701:log-group:/aws/lambda/logjam-brain-watchdog" }
    override_during = plan
  }

  # Mutation: s3:GetObject (or s3:*, or an s3:GetObject* pattern) on the backup
  # bucket or any bucket but signals, `status.json`/`drill.json` widened to
  # `/*`, or any action beyond the four listed. The watchdog is handed an
  # alarm and a log: reading a backup object would put it one step from user
  # data (infra/AGENTS.md).
  assert {
    condition = alltrue([
      for st in jsondecode(aws_iam_role_policy.brain_watchdog[0].policy).Statement : st.Effect == "Allow" && alltrue([
        for a in flatten([st.Action]) : (
          (a == "s3:GetObject" && toset(flatten([st.Resource])) == toset([
            "arn:aws:s3:::logjam-brain-signals-620853681701/status.json",
            "arn:aws:s3:::logjam-brain-signals-620853681701/drill.json",
          ])) ||
          (a == "s3:ListBucket" && flatten([st.Resource]) == ["arn:aws:s3:::logjam-brain-backups-620853681701"]) ||
          (contains(["logs:CreateLogStream", "logs:PutLogEvents"], a) && startswith(st.Resource, "arn:aws:logs:ap-southeast-2:620853681701:log-group:/aws/lambda/logjam-brain-watchdog:"))
        )
      ])
    ])
    error_message = "The watchdog's role may only read status.json and drill.json, list the backup bucket, and write its own log group (infra/AGENTS.md)."
  }

  # Mutation: dropping the prefix condition (the function could list the
  # whole bucket: every backup file's name), or a prefix other than the WAL
  # archive.
  assert {
    condition = alltrue([
      for st in jsondecode(aws_iam_role_policy.brain_watchdog[0].policy).Statement :
      !contains(flatten([st.Action]), "s3:ListBucket") || try(st.Condition.StringLike["s3:prefix"] == "logjam/archive/logjam/*", false)
    ])
    error_message = "The watchdog may list only the WAL archive's prefix in the backup bucket."
  }
}

run "brain_watchdog_lists_the_archive_pgbackrest_writes" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [aws_lambda_function.brain_watchdog]
  }

  override_resource {
    target          = aws_iam_role.brain_watchdog
    values          = { arn = "arn:aws:iam::620853681701:role/logjam-brain-watchdog" }
    override_during = plan
  }

  # Mutation: a different path or stanza in the image's pgBackRest
  # configuration (pgbackrest-conf.sh, brain-entrypoint.sh) or in
  # local.brain_wal_prefix. The function would list a prefix that holds
  # nothing and every run would fail wal_stale: or, worse, after a change that
  # also dropped the check, never notice a stalled archive.
  assert {
    condition = (
      aws_lambda_function.brain_watchdog[0].environment[0].variables["WAL_PREFIX"] == "logjam/archive/logjam/" &&
      strcontains(file("../../../brain/postgres/pgbackrest-conf.sh"), "repo1-path=/logjam\"") &&
      strcontains(file("../../../brain/postgres/brain-entrypoint.sh"), "--stanza=logjam ")
    )
    error_message = "The watchdog must list <repo1-path>/archive/<stanza>/ as the Postgres image's pgBackRest configuration writes it."
  }

  # Mutation: the timeout under the function's own two API tries (2 x 10 s)
  # plus its S3 calls.
  assert {
    condition     = aws_lambda_function.brain_watchdog[0].timeout == 60 && aws_lambda_function.brain_watchdog[0].handler == "handler.handler"
    error_message = "The watchdog's timeout is 60 seconds and its handler is handler.handler."
  }
}

run "brain_watchdog_runs_every_five_minutes_and_never_retries" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [
      aws_cloudwatch_event_rule.brain_watchdog,
      aws_cloudwatch_event_target.brain_watchdog,
      aws_lambda_function_event_invoke_config.brain_watchdog,
    ]
  }

  override_resource {
    target          = aws_iam_role.brain_watchdog
    values          = { arn = "arn:aws:iam::620853681701:role/logjam-brain-watchdog" }
    override_during = plan
  }

  # Mutation: a longer rate (the stale-WAL alarm window is 5 minutes), or
  # removing the invoke config / `maximum_retry_attempts` above 0: a failed run
  # raises on purpose, an asynchronous invoke retries twice by default, and one
  # bad run would then count as three errors and trip the 2-of-3 alarm alone.
  assert {
    condition = (
      aws_cloudwatch_event_rule.brain_watchdog[0].schedule_expression == "rate(5 minutes)" &&
      length(aws_cloudwatch_event_target.brain_watchdog) == 1 &&
      length(aws_lambda_function_event_invoke_config.brain_watchdog) == 1 &&
      aws_lambda_function_event_invoke_config.brain_watchdog[0].maximum_retry_attempts == 0
    )
    error_message = "The watchdog must run every 5 minutes, and a failing run must not be retried."
  }
}

run "brain_watchdog_alarms_page_the_topic_and_watch_the_watchdog" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [
      aws_cloudwatch_metric_alarm.brain_watchdog_checks_failing,
      aws_cloudwatch_metric_alarm.brain_watchdog_dead,
    ]
  }

  override_resource {
    target          = aws_iam_role.brain_watchdog
    values          = { arn = "arn:aws:iam::620853681701:role/logjam-brain-watchdog" }
    override_during = plan
  }

  # Mutation: `datapoints_to_alarm = 1` (one blip pages) or 3 (a check that
  # fails for 10 minutes does not), another metric or threshold, no topic, or
  # an alarm description without its "First:" step.
  assert {
    condition = (
      aws_cloudwatch_metric_alarm.brain_watchdog_checks_failing[0].metric_name == "Errors" &&
      aws_cloudwatch_metric_alarm.brain_watchdog_checks_failing[0].period == 300 &&
      aws_cloudwatch_metric_alarm.brain_watchdog_checks_failing[0].evaluation_periods == 3 &&
      aws_cloudwatch_metric_alarm.brain_watchdog_checks_failing[0].datapoints_to_alarm == 2 &&
      aws_cloudwatch_metric_alarm.brain_watchdog_checks_failing[0].threshold == 1 &&
      aws_cloudwatch_metric_alarm.brain_watchdog_checks_failing[0].comparison_operator == "GreaterThanOrEqualToThreshold"
    )
    error_message = "The checks-failing alarm must fire on an error in 2 of the last 3 five-minute periods."
  }

  # Mutation: treating missing data as notBreaching (a watchdog that never runs
  # then stays green), a longer period, a different comparison, or no topic.
  assert {
    condition = (
      aws_cloudwatch_metric_alarm.brain_watchdog_dead[0].metric_name == "Invocations" &&
      aws_cloudwatch_metric_alarm.brain_watchdog_dead[0].period == 900 &&
      aws_cloudwatch_metric_alarm.brain_watchdog_dead[0].comparison_operator == "LessThanThreshold" &&
      aws_cloudwatch_metric_alarm.brain_watchdog_dead[0].threshold == 1 &&
      aws_cloudwatch_metric_alarm.brain_watchdog_dead[0].treat_missing_data == "breaching"
    )
    error_message = "The not-running alarm must fire on fewer than one invocation in 15 minutes, missing data included."
  }

  assert {
    condition = alltrue([
      for a in [aws_cloudwatch_metric_alarm.brain_watchdog_checks_failing[0], aws_cloudwatch_metric_alarm.brain_watchdog_dead[0]] :
      contains(a.alarm_actions, aws_sns_topic.alerts.arn) && strcontains(a.alarm_description, "First: ") && a.dimensions["FunctionName"] == "logjam-brain-watchdog"
    ])
    error_message = "Both watchdog alarms must tell the alerts topic, name their function and start with a First: step."
  }
}

run "brain_drill_role_cannot_write_the_backups" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [aws_iam_role_policy.brain_drill]
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

  # Mutation: s3:PutObject (or DeleteObject, ListBucketVersions, s3:*) beside
  # the backup bucket in any statement, or PutObject on the signals bucket
  # beyond drill.json. The task holds a full copy of the database and the
  # restored server must not be able to reach back into the repository it came
  # from: a copy that archived into it would corrupt the one thing the drill
  # proves (the spike broke its own repository that way).
  assert {
    condition = alltrue([
      for st in jsondecode(aws_iam_role_policy.brain_drill[0].policy).Statement : st.Effect == "Allow" && alltrue([
        for a in flatten([st.Action]) : (
          (a == "s3:GetObject" && flatten([st.Resource]) == ["arn:aws:s3:::logjam-brain-backups-620853681701/*"]) ||
          (a == "s3:ListBucket" && flatten([st.Resource]) == ["arn:aws:s3:::logjam-brain-backups-620853681701"]) ||
          (a == "s3:PutObject" && flatten([st.Resource]) == ["arn:aws:s3:::logjam-brain-signals-620853681701/drill.json"])
        )
      ])
    ])
    error_message = "The restore drill's task role may only read and list the backup bucket and write drill.json (infra/AGENTS.md)."
  }
}

run "brain_drill_log_is_not_the_audit_trail" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [
      aws_cloudwatch_log_group.brain_drill,
      aws_cloudwatch_log_subscription_filter.brain_pgaudit_to_firehose,
      aws_cloudwatch_log_subscription_filter.pgaudit_to_firehose,
    ]
  }

  override_resource {
    target          = aws_kinesis_firehose_delivery_stream.pgaudit
    values          = { arn = "arn:aws:firehose:ap-southeast-2:620853681701:deliverystream/mock" }
    override_during = plan
  }

  # Mutation: a subscription filter on /logjam/brain/drill (to the audit
  # Firehose or any other): the drill's log would land in the WORM bucket as
  # if it were prod's audit trail. The test covers the two filters that exist
  # and every .tf file: a new filter resource anywhere must not name the group,
  # by its resource or by its literal name.
  assert {
    condition = alltrue(concat(
      [
        for f in [aws_cloudwatch_log_subscription_filter.brain_pgaudit_to_firehose, aws_cloudwatch_log_subscription_filter.pgaudit_to_firehose] :
        f.log_group_name != aws_cloudwatch_log_group.brain_drill[0].name
      ],
      flatten([
        for f in fileset(".", "*.tf") : [
          for block in regexall("(?s)aws_cloudwatch_log_subscription_filter\" \"[a-z_]+\" \\{.*?\n\\}\n", file(f)) : !strcontains(block, "brain_drill") && !strcontains(block, "logjam/brain/drill")
        ]
      ]),
    ))
    error_message = "The restore drill's log group must have no subscription filter."
  }
}

run "brain_drill_runs_daily_after_the_backup_on_arm" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
  }
  plan_options {
    target = [
      aws_scheduler_schedule.brain_drill,
      aws_ecs_task_definition.brain_drill,
      aws_security_group.brain_drill,
    ]
  }

  override_resource {
    target          = aws_iam_role.brain_drill
    values          = { arn = "arn:aws:iam::620853681701:role/logjam-brain-drill" }
    override_during = plan
  }
  override_resource {
    target          = aws_iam_role.ecs_task_execution
    values          = { arn = "arn:aws:iam::620853681701:role/ecsTaskExecutionRole" }
    override_during = plan
  }
  override_resource {
    target          = aws_cloudwatch_log_group.brain_drill
    values          = { name = "/logjam/brain/drill" }
    override_during = plan
  }

  # Mutation: another time or zone (the 03:00 full backup would be an hour
  # old at best, or the drill would restore yesterday's), a weekly or monthly
  # cron (the first verdict would take a week and the watchdog fails at 50
  # hours), or a day-of-week other than `?` .
  assert {
    condition = (
      aws_scheduler_schedule.brain_drill[0].schedule_expression == "cron(30 4 * * ? *)" &&
      aws_scheduler_schedule.brain_drill[0].schedule_expression_timezone == "Australia/Sydney"
    )
    error_message = "The restore drill must run daily at 04:30 Australia/Sydney, after the 03:00 full backup."
  }

  # Mutation: X86_64 (the brain and its image are arm64; the drill would pull
  # an image that does not exist for it), a different command, a size under
  # 2 GiB, or an ephemeral size below Fargate's minimum of 21 GiB.
  assert {
    condition = (
      aws_ecs_task_definition.brain_drill[0].runtime_platform[0].cpu_architecture == "ARM64" &&
      aws_ecs_task_definition.brain_drill[0].memory == "2048" &&
      aws_ecs_task_definition.brain_drill[0].ephemeral_storage[0].size_in_gib >= 21 &&
      jsondecode(aws_ecs_task_definition.brain_drill[0].container_definitions)[0].command == ["/usr/local/lib/brain/drill.sh"] &&
      endswith(jsondecode(aws_ecs_task_definition.brain_drill[0].container_definitions)[0].image, ":test")
    )
    error_message = "The restore drill must run drill.sh from the brain's Postgres image, pinned by tag, on ARM64 with 2 GiB."
  }

  # Mutation: any ingress rule. The drill never connects to the brain, and
  # nothing may connect to a task holding a copy of the database.
  assert {
    condition     = length(aws_security_group.brain_drill[0].ingress) == 0
    error_message = "The restore drill's security group must have no ingress."
  }
}

# ── The switch: what brain.auto.tfvars flips (cloudfront.tf, ecs.tf, monitoring.tf) ──

run "brain_settings_are_one_file_and_read_by_the_workflows" {
  command = plan
  plan_options {
    target = [aws_sns_topic.alerts]
  }

  # The deploy workflows read brain_serving from brain.auto.tfvars with
  # infra/scripts/brain-setting.sh, which reads one-line settings, so that file
  # is the only place a setting may come from: another *.tfvars (or .json) file
  # would be loaded after it and win in Terraform, unseen by the workflows. And
  # every setting the file carries is pinned at the top of this file, so the
  # suite says the same whatever the file says.
  # Mutation: a second terraform.tfvars or zz.auto.tfvars in this directory;
  # brain_serving or brain_public written as an expression or a quoted string;
  # a setting added to brain.auto.tfvars (say brain_cpu_credits = "standard")
  # and not to the variables block at the top of this file.
  assert {
    condition = (
      aws_sns_topic.alerts.name == "logjam-alerts" &&
      fileset(".", "*.tfvars*") == toset(["brain.auto.tfvars"]) &&
      alltrue([for l in ["brain_serving", "brain_public", "brain_bootstrap"] : can(regex("(?m)^${l} = (true|false)( #.*)?$", file("brain.auto.tfvars")))]) &&
      length(setsubtract(
        toset(flatten(regexall("(?m)^(brain_[a-z_]+) *=", file("brain.auto.tfvars")))),
        toset(flatten(regexall("(?m)^  (brain_[a-z_]+) *=", file("tests/guards.tftest.hcl"))))
      )) == 0
    )
    error_message = "brain.auto.tfvars must be the only tfvars file, hold brain_serving, brain_public and brain_bootstrap as one-line true or false, and every setting in it must be pinned in the variables block at the top of tests/guards.tftest.hcl."
  }
}

run "brain_variable_defaults_are_inert" {
  command = plan
  plan_options {
    target = [aws_sns_topic.alerts]
  }

  # The suite pins the settings (above), so the defaults are read from the
  # source. Mutation: default = "x" on brain_pg_image_tag, or true on
  # brain_serving, brain_public or brain_bootstrap: a plan with the settings
  # file absent (or one that leaves a line out) would build or switch things on.
  assert {
    condition = (
      aws_sns_topic.alerts.name == "logjam-alerts" &&
      can(regex("variable \"brain_pg_image_tag\" \\{[^}]*default += \"\"", file("brain_variables.tf"))) &&
      alltrue([for v in ["brain_serving", "brain_public", "brain_bootstrap"] : can(regex("variable \"${v}\" \\{[^}]*default += false", file("brain_variables.tf")))])
    )
    error_message = "brain_pg_image_tag must default to empty and brain_serving, brain_public and brain_bootstrap to false (brain_variables.tf)."
  }
}

run "brain_public_without_brain_serving_is_refused" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
    brain_serving      = false
    brain_public       = true
  }
  # Targets that use the variable (two, so that a mutation of one does not hide
  # the validation): a plan evaluates only the variables the targeted resources
  # need, and validation runs with the variable.
  plan_options {
    target = [aws_cloudfront_distribution.api, aws_cloudwatch_metric_alarm.api_environment_degraded]
  }

  # Mutation: dropping the validation on brain_public points CloudFront at a
  # brain whose API is not running.
  expect_failures = [var.brain_public]
}

run "brain_serving_without_an_image_tag_is_refused" {
  command = plan
  variables {
    brain_pg_image_tag = ""
    brain_serving      = true
  }
  plan_options {
    target = [aws_ecs_task_definition.api_migrate, aws_instance.brain]
  }

  # Mutation: dropping the validation on brain_serving points every task
  # definition at an address that does not exist.
  expect_failures = [var.brain_serving]
}

run "brain_is_dormant_for_cloudfront_and_tasks" {
  command = plan
  override_resource {
    target          = aws_security_group.worker
    values          = { id = "sg-mockworker" }
    override_during = plan
  }
  plan_options {
    target = [
      aws_cloudfront_distribution.api,
      aws_ecs_task_definition.api_script,
      aws_ecs_task_definition.topo_worker,
      aws_ecs_task_definition.api_migrate,
      aws_ecs_task_definition.topo_export_worker,
      aws_cloudwatch_log_metric_filter.api_5xx,
      aws_cloudwatch_log_metric_filter.sync_client,
      aws_cloudwatch_metric_alarm.api_environment_degraded,
    ]
  }

  # With the settings off (the pinned values) everything the switch reaches is
  # as it is today: CloudFront's API origin is Elastic Beanstalk's name, the
  # four task definitions with a DB_HOST name RDS and set no DATABASE_SSL_CA,
  # the request-log filters read Elastic Beanstalk's group and its health alarm
  # pages. Mutation: changing the Elastic Beanstalk or RDS literal, or the
  # else branch of local.db_environment or of the origin's domain_name.
  assert {
    condition = (
      one(aws_cloudfront_distribution.api.origin).domain_name == "logjam-api-prod.eba-iwmwkydz.ap-southeast-2.elasticbeanstalk.com" &&
      one(aws_cloudfront_distribution.api.origin).origin_id == "logjam-api-prod.eba-iwmwkydz.ap-southeast-2.elasticbeanstalk.com-mn1lh8nq4kl" &&
      aws_cloudfront_distribution.api.default_cache_behavior[0].target_origin_id == one(aws_cloudfront_distribution.api.origin).origin_id &&
      alltrue([
        for td in [aws_ecs_task_definition.api_script, aws_ecs_task_definition.topo_worker, aws_ecs_task_definition.api_migrate, aws_ecs_task_definition.topo_export_worker] :
        { for e in jsondecode(td.container_definitions)[0].environment : e.name => e.value }["DB_HOST"] == "logjam-db-enc.chwko8w4iz9p.ap-southeast-2.rds.amazonaws.com" &&
        !contains([for e in jsondecode(td.container_definitions)[0].environment : e.name], "DATABASE_SSL_CA")
      ]) &&
      [for e in jsondecode(aws_ecs_task_definition.api_migrate.container_definitions)[0].environment : e.name] == ["AWS_REGION", "DB_HOST", "DB_NAME", "DB_PORT", "NODE_ENV"] &&
      aws_cloudwatch_log_metric_filter.api_5xx.log_group_name == "/aws/elasticbeanstalk/logjam-api-prod/var/log/eb-docker/containers/eb-current-app/stdouterr.log" &&
      aws_cloudwatch_log_metric_filter.sync_client.log_group_name == aws_cloudwatch_log_metric_filter.api_5xx.log_group_name &&
      aws_cloudwatch_metric_alarm.api_environment_degraded.actions_enabled == true
    )
    error_message = "With brain_serving and brain_public off, CloudFront, the four database task definitions, the request-log filters and the health alarm must be exactly as they are with Elastic Beanstalk serving."
  }
}

run "brain_serving_points_every_database_task_at_the_brain" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
    brain_serving      = true
  }
  override_resource {
    target          = aws_security_group.worker
    values          = { id = "sg-mockworker" }
    override_during = plan
  }
  plan_options {
    target = [
      aws_cloudfront_distribution.api,
      aws_ecs_task_definition.api_script,
      aws_ecs_task_definition.topo_worker,
      aws_ecs_task_definition.api_migrate,
      aws_ecs_task_definition.topo_export_worker,
      aws_cloudwatch_log_metric_filter.api_5xx,
      aws_cloudwatch_log_metric_filter.sync_client,
      aws_cloudwatch_metric_alarm.api_environment_degraded,
    ]
  }

  # Every task definition that has a DB_HOST names the brain's address with the
  # certificate path to verify it by, so a worker left on RDS would write its
  # job results to a database nobody reads. The definitions are enumerated
  # here and the DB_HOST literals counted in every .tf file (the two entries of
  # local.db_environment), so a new definition with a DB_HOST of its own fails
  # until it follows brain_serving. And serving alone moves nothing else:
  # CloudFront, the filters and the health alarm wait for brain_public.
  # Mutation: one definition's `local.db_environment` replaced by a literal
  # DB_HOST (RDS's name); a new task definition with a literal DB_HOST; the
  # certificate entry dropped from local.db_environment; the origin's domain or
  # a filter's group following brain_serving instead of brain_public.
  assert {
    condition = (
      alltrue([
        for td in [aws_ecs_task_definition.api_script, aws_ecs_task_definition.topo_worker, aws_ecs_task_definition.api_migrate, aws_ecs_task_definition.topo_export_worker] :
        { for e in jsondecode(td.container_definitions)[0].environment : e.name => e.value }["DB_HOST"] == aws_eip.brain[0].public_dns &&
        { for e in jsondecode(td.container_definitions)[0].environment : e.name => e.value }["DATABASE_SSL_CA"] == "/app/brain-ca.pem"
      ]) &&
      sum([for f in fileset(".", "*.tf") : length(regexall("\"DB_HOST\"", file(f)))]) == 2 &&
      one(aws_cloudfront_distribution.api.origin).domain_name == "logjam-api-prod.eba-iwmwkydz.ap-southeast-2.elasticbeanstalk.com" &&
      aws_cloudwatch_log_metric_filter.api_5xx.log_group_name == "/aws/elasticbeanstalk/logjam-api-prod/var/log/eb-docker/containers/eb-current-app/stdouterr.log" &&
      aws_cloudwatch_log_metric_filter.sync_client.log_group_name == aws_cloudwatch_log_metric_filter.api_5xx.log_group_name &&
      aws_cloudwatch_metric_alarm.api_environment_degraded.actions_enabled == true
    )
    error_message = "With brain_serving, every task definition with a DB_HOST must name the brain and set DATABASE_SSL_CA, and nothing CloudFront-side may move yet."
  }
}

run "brain_public_points_cloudfront_at_the_brain" {
  command = plan
  variables {
    brain_pg_image_tag = "test"
    brain_serving      = true
    brain_public       = true
  }
  # The alarm is imported (monitoring.tf), which a mocked provider cannot do.
  override_resource {
    target          = aws_cloudwatch_metric_alarm.api_5xx
    values          = {}
    override_during = plan
  }
  plan_options {
    target = [
      aws_cloudfront_distribution.api,
      aws_cloudwatch_log_metric_filter.api_5xx,
      aws_cloudwatch_log_metric_filter.sync_client,
      aws_cloudwatch_metric_alarm.api_environment_degraded,
      aws_cloudwatch_metric_alarm.api_5xx,
    ]
  }

  # CloudFront's API origin is the brain's address and nothing else about the
  # origin moves: the id the behavior names, plain HTTP on 80 and the
  # X-Origin-Verify header the API insists on. The request-log filters follow
  # to the brain's group (the health alarm of the idle Elastic Beanstalk stops
  # paging; the 5xx alarm still does).
  # Mutation: dropping the custom_header block (the API would refuse every
  # request), another port or protocol, the domain left on Elastic Beanstalk,
  # a filter left on Elastic Beanstalk's group, the health alarm still paging.
  assert {
    condition     = one(aws_cloudfront_distribution.api.origin).domain_name == aws_eip.brain[0].public_dns
    error_message = "With brain_public, CloudFront's API origin must be the brain's address."
  }

  assert {
    condition     = one(aws_cloudfront_distribution.api.origin).origin_id == aws_cloudfront_distribution.api.default_cache_behavior[0].target_origin_id
    error_message = "The API origin's id must stay the one the default behavior names."
  }

  assert {
    condition     = [for h in one(aws_cloudfront_distribution.api.origin).custom_header : h.name] == ["X-Origin-Verify"]
    error_message = "The API origin must keep sending X-Origin-Verify: the API refuses a request without it."
  }

  assert {
    condition = (
      one(aws_cloudfront_distribution.api.origin).custom_origin_config[0].http_port == 80 &&
      one(aws_cloudfront_distribution.api.origin).custom_origin_config[0].origin_protocol_policy == "http-only"
    )
    error_message = "The API origin must stay plain HTTP on port 80: the brain's security group admits CloudFront on 80 only."
  }

  assert {
    condition = (
      aws_cloudwatch_log_metric_filter.api_5xx.log_group_name == "/logjam/brain/api" &&
      aws_cloudwatch_log_metric_filter.sync_client.log_group_name == "/logjam/brain/api"
    )
    error_message = "With brain_public, the request-log filters must read the brain's API log group."
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.api_environment_degraded.actions_enabled == false &&
      aws_cloudwatch_metric_alarm.api_5xx.alarm_actions == toset(["arn:aws:sns:ap-southeast-2:620853681701:logjam-alerts"])
    )
    error_message = "With brain_public, the idle Elastic Beanstalk health alarm must not page and the 5xx alarm must."
  }
}

run "cost_ceiling_denies_only_workers_and_uploads" {
  command = plan
  plan_options {
    target = [aws_iam_policy.cost_ceiling_deny]
  }

  # Mutation: `Resource = "*"` (or a brain bucket) on the S3 statement, a third
  # statement, or another action. The brain's role is shared by the API and by
  # pgBackRest: a deny on the backup or signals bucket stops WAL archiving, and
  # a cost alarm becomes data loss.
  assert {
    condition = (
      alltrue([for st in jsondecode(aws_iam_policy.cost_ceiling_deny.policy).Statement : st.Effect == "Deny"]) &&
      [for st in jsondecode(aws_iam_policy.cost_ceiling_deny.policy).Statement : [st.Sid, flatten([st.Action]), flatten([st.Resource])]] == [
        ["NoNewWorkers", ["ecs:RunTask"], ["arn:aws:ecs:ap-southeast-2:620853681701:task-definition/*"]],
        ["NoUploads", ["s3:PutObject"], ["arn:aws:s3:::logjam-media/*", "arn:aws:s3:::logjam-topo-jobs/*"]],
      ]
    )
    error_message = "The cost-ceiling deny may stop only ecs:RunTask and s3:PutObject on the media and topo-jobs buckets, never the brain's backup or signals bucket."
  }
}

run "cost_ceiling_role_attaches_only_the_deny" {
  command = plan
  plan_options {
    target = [
      aws_iam_role.budget_breaker,
      aws_iam_role_policy.budget_breaker,
    ]
  }

  override_resource {
    target          = aws_iam_role.brain
    values          = { arn = "arn:aws:iam::620853681701:role/logjam-brain" }
    override_during = plan
  }
  override_resource {
    target          = aws_iam_policy.cost_ceiling_deny
    values          = { arn = "arn:aws:iam::620853681701:policy/logjam-cost-ceiling-deny" }
    override_during = plan
  }

  # Mutation: dropping the `iam:PolicyARN` condition (Budgets' role could then
  # attach any policy, AdministratorAccess included, to those roles), another
  # action or resource, or a role in the resources list.
  assert {
    condition = (
      length(jsondecode(aws_iam_role_policy.budget_breaker.policy).Statement) == 1 &&
      jsondecode(aws_iam_role_policy.budget_breaker.policy).Statement[0].Effect == "Allow" &&
      jsondecode(aws_iam_role_policy.budget_breaker.policy).Statement[0].Action == ["iam:AttachRolePolicy", "iam:DetachRolePolicy"] &&
      toset(jsondecode(aws_iam_role_policy.budget_breaker.policy).Statement[0].Resource) == toset([
        "arn:aws:iam::620853681701:role/logjam-eb-role",
        "arn:aws:iam::620853681701:role/logjam-brain",
      ]) &&
      try(jsondecode(aws_iam_role_policy.budget_breaker.policy).Statement[0].Condition, null) == {
        ArnEquals = { "iam:PolicyARN" = "arn:aws:iam::620853681701:policy/logjam-cost-ceiling-deny" }
      }
    )
    error_message = "The budget role may only attach or detach the cost-ceiling deny policy, on the EB role and the brain role."
  }

  # Mutation: removing either condition lets any budget (or, for the account,
  # any account's budget) make Budgets assume the role.
  assert {
    condition = (
      length(jsondecode(aws_iam_role.budget_breaker.assume_role_policy).Statement) == 1 &&
      jsondecode(aws_iam_role.budget_breaker.assume_role_policy).Statement[0].Principal == { Service = "budgets.amazonaws.com" } &&
      jsondecode(aws_iam_role.budget_breaker.assume_role_policy).Statement[0].Condition == {
        StringEquals = { "aws:SourceAccount" = "620853681701" }
        ArnLike      = { "aws:SourceArn" = "arn:aws:budgets::620853681701:budget/*" }
      }
    )
    error_message = "Only AWS Budgets in this account may assume the budget role."
  }
}

run "cost_ceiling_action_fires_on_actual_spend_and_is_pre_tax" {
  command = plan
  plan_options {
    target = [
      aws_budgets_budget.ceiling,
      aws_budgets_budget_action.ceiling,
    ]
  }

  override_resource {
    target          = aws_iam_policy.cost_ceiling_deny
    values          = { arn = "arn:aws:iam::620853681701:policy/logjam-cost-ceiling-deny" }
    override_during = plan
  }

  # Mutation: notification_type = "FORECASTED" (fires on a projection, before
  # anything is spent), approval_model = "MANUAL" (nobody is awake to approve),
  # a threshold below 100, a role other than the two, or a different policy.
  assert {
    condition = (
      aws_budgets_budget_action.ceiling.notification_type == "ACTUAL" &&
      aws_budgets_budget_action.ceiling.approval_model == "AUTOMATIC" &&
      aws_budgets_budget_action.ceiling.action_type == "APPLY_IAM_POLICY" &&
      aws_budgets_budget_action.ceiling.action_threshold[0].action_threshold_value == 100 &&
      aws_budgets_budget_action.ceiling.action_threshold[0].action_threshold_type == "PERCENTAGE" &&
      toset(aws_budgets_budget_action.ceiling.definition[0].iam_action_definition[0].roles) == toset(["logjam-eb-role", "logjam-brain"]) &&
      aws_budgets_budget_action.ceiling.definition[0].iam_action_definition[0].policy_arn == "arn:aws:iam::620853681701:policy/logjam-cost-ceiling-deny"
    )
    error_message = "The ceiling action must attach the deny policy to the EB and brain roles automatically at 100% of actual spend."
  }

  # Mutation: include_tax = true counts GST towards a pre-tax ceiling, so the
  # breaker fires about 10% early.
  assert {
    condition     = aws_budgets_budget.ceiling.cost_types[0].include_tax == false && aws_budgets_budget.ceiling.time_unit == "MONTHLY"
    error_message = "The cost ceiling is a monthly pre-tax figure."
  }
}

run "signup_cap_role_does_one_update_and_writes_its_logs" {
  command = plan
  plan_options {
    target = [aws_iam_role_policy.cognito_pre_signup]
  }

  override_resource {
    target          = aws_dynamodb_table.signup_counter
    values          = { arn = "arn:aws:dynamodb:ap-southeast-2:620853681701:table/mock" }
    override_during = plan
  }
  override_resource {
    target          = aws_cloudwatch_log_group.cognito_pre_signup
    values          = { arn = "arn:aws:logs:ap-southeast-2:620853681701:log-group:/aws/lambda/mock" }
    override_during = plan
  }

  # Mutation: adding an action (GetItem, PutItem, DeleteItem, Scan), a second
  # statement, or a Resource of "*" lets a compromised or buggy function read
  # or rewrite the counter, or another table, or write another group's logs.
  assert {
    condition = (
      length(jsondecode(aws_iam_role_policy.cognito_pre_signup.policy).Statement) == 2 &&
      anytrue([
        for st in jsondecode(aws_iam_role_policy.cognito_pre_signup.policy).Statement :
        st.Effect == "Allow" && st.Action == "dynamodb:UpdateItem" &&
        st.Resource == "arn:aws:dynamodb:ap-southeast-2:620853681701:table/mock"
      ]) &&
      anytrue([
        for st in jsondecode(aws_iam_role_policy.cognito_pre_signup.policy).Statement :
        st.Effect == "Allow" && toset(st.Action) == toset(["logs:CreateLogStream", "logs:PutLogEvents"]) &&
        st.Resource == "arn:aws:logs:ap-southeast-2:620853681701:log-group:/aws/lambda/mock:*"
      ])
    )
    error_message = "The pre sign-up function's role may only UpdateItem on the counter table and write its own log group (cognito_signup_cap.tf)."
  }
}

run "signup_cap_counter_table_cannot_be_deleted" {
  command = plan
  plan_options {
    target = [aws_dynamodb_table.signup_counter]
  }

  # Mutation: dropping deletion_protection_enabled lets a destroy delete the
  # counter, and the function, which fails open on a missing table, then stops
  # capping sign-ups.
  assert {
    condition     = aws_dynamodb_table.signup_counter.deletion_protection_enabled == true
    error_message = "The sign-up counter table must be protected from deletion: deleting it lifts the cap (cognito_signup_cap.tf)."
  }
}

run "signup_cap_variable_stays_inside_the_free_tier" {
  command = plan
  plan_options {
    target = [aws_lambda_function.cognito_pre_signup]
  }
  variables {
    signup_cap_per_month = 10000
  }

  # Mutation: raising the validation's upper bound to 10,000 or more, or
  # dropping it, lets a cap sit at the whole free tier with existing users on
  # top of it.
  expect_failures = [var.signup_cap_per_month]
}

run "cognito_pool_keeps_email_sender_and_has_pre_sign_up" {
  command = plan
  plan_options {
    target = [aws_cognito_user_pool.main]
  }

  override_resource {
    target          = aws_lambda_function.cognito_email_sender
    values          = { arn = "arn:aws:lambda:ap-southeast-2:620853681701:function:email-mock" }
    override_during = plan
  }
  override_resource {
    target          = aws_lambda_function.cognito_pre_signup
    values          = { arn = "arn:aws:lambda:ap-southeast-2:620853681701:function:signup-mock" }
    override_during = plan
  }
  override_resource {
    target          = aws_kms_key.cognito_email
    values          = { arn = "arn:aws:kms:ap-southeast-2:620853681701:key/mock" }
    override_during = plan
  }

  # Mutation: rewriting lambda_config without custom_email_sender or its KMS
  # key sends every verification code through Cognito's default sender, which
  # spam filters bin, and nothing fails a plan or a deploy.
  assert {
    condition = (
      length(aws_cognito_user_pool.main.lambda_config[0].custom_email_sender) == 1 &&
      aws_cognito_user_pool.main.lambda_config[0].custom_email_sender[0].lambda_arn == "arn:aws:lambda:ap-southeast-2:620853681701:function:email-mock" &&
      aws_cognito_user_pool.main.lambda_config[0].kms_key_id == "arn:aws:kms:ap-southeast-2:620853681701:key/mock"
    )
    error_message = "The user pool must keep custom_email_sender and its KMS key (cognito.tf)."
  }

  # Mutation: dropping pre_sign_up from lambda_config leaves sign-ups
  # uncapped, and Cognito's bill without a ceiling.
  assert {
    condition     = aws_cognito_user_pool.main.lambda_config[0].pre_sign_up == "arn:aws:lambda:ap-southeast-2:620853681701:function:signup-mock"
    error_message = "The user pool must run the pre sign-up function that caps new accounts (cognito.tf)."
  }
}
