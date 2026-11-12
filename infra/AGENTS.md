# Infra

Terraform (`terraform/`, >= 1.10) is the source of truth for prod AWS
(`terraform/envs/prod`, S3 state; `terraform output` there gives prod's
values), for this repository's GitHub settings (`terraform/envs/github`:
rulesets, Environments, Actions variables, labels,
[0025](../docs/decisions/0025-github-settings-in-terraform.md)) and for local
dev's MiniStack resources and `.env.local` (`terraform/envs/local`, which
`make dev` applies).

- **Prod and GitHub settings apply only from `terraform-apply.yml`, never a laptop:** merging a PR
  applies the plan the maintainer read in its comment, and the workflow refuses
  any other plan (`infra/scripts/plan-summary.mjs`,
  [0026](../docs/decisions/0026-plan-fingerprint-covers-planned-values.md)).
  `terraform plan` is read-only. The one exception is a change to the apply
  role or its boundary (`terraform/envs/prod/iam_apply.tf`), which that role
  may not make: the maintainer applies it from their machine.
  A plan in `envs/prod` on a fresh checkout fails until the Lambda bundle it
  zips is built: `cd infra/lambda/cognito-email-sender && npm ci && npm run build`,
  and the same in `infra/lambda/cognito-pre-signup`.
- **Change AWS and the repository's GitHub settings only through Terraform,**
  never the console, the CLI or GitHub's Settings pages: what is made by hand
  is drift the next plan undoes. Secret values, the two settings Apps and
  private vulnerability reporting are set by hand (0025).
- **A new secret** is an `aws_secretsmanager_secret` with no version in
  Terraform; its value is set by hand and tasks read the resource's `.arn`. A
  literal ARN is only for a secret made outside Terraform.
- **CI owns deploy-time fields:** image revisions (`infra/scripts/pin-ecs-task-image.sh`),
  the brain's release pointer and the frontend bucket's contents. Terraform
  ignores them; never make it manage them.
- **A plan that destroys or replaces a stateful resource** (the brain's data
  volume, S3, Cognito, CloudFront, the audit trail) is a stop: ask. Never remove `prevent_destroy`
  to get past one.
- **The CI roles' privacy Deny** (`local.ci_readonly_privacy_deny` in
  `terraform/envs/prod/iam.tf`) stays on every read-only role and in the apply
  role's boundary: CI never reads user data, audit objects, logs or secret
  values. Objects in this account's buckets and log events are denied by
  default; a bucket CI must read objects from is added to the Deny's
  exceptions and to its guard.
- **The privacy Deny lists every route to a shell on an instance or in a task,
  to a command's output and to a disk snapshot's contents** (`ssm:SendCommand`,
  `ssm:StartSession`, `ssm:ResumeSession`, `ecs:ExecuteCommand`;
  `ssm:GetCommandInvocation`, `ssm:ListCommandInvocations`, `ssm:ListCommands`;
  `ebs:GetSnapshotBlock`, `ebs:ListSnapshotBlocks`, `ebs:ListChangedBlocks`):
  only the maintainer's own identity operates the brain, and `ReadOnlyAccess`
  allows the `ssm:` reads. Guard: `ci_reads_no_secret_or_user_data`.
- **A bucket that holds user data or a copy of the database gets object events
  on the audit trail** (`audit_event_selectors` in `audit.tf`), and the trail
  records EBS direct API calls on snapshots; the audit bucket itself never
  does. The trail uses advanced selectors only, so a new bucket is a new
  selector there, not a basic one. Guard: `audit_trail_records_every_route_to_user_data`.
- **The brain's rules** (the bullets from here down that name the brain, and the
  two above this one about shells and the audit trail) are explained in
  [0047](../docs/decisions/0047-prod-runs-on-one-self-managed-instance-with-object-lock-backups.md);
  running it is `docs/operations/brain.md`.
- **The brain's signals bucket holds no user data** (`release.json`,
  `status.json`, `drill.json`: a release pointer and health files). The brain and the watchdog read it; CI only writes
  `release.json` to it and never reads it, so it is not an exception of the CI
  privacy Deny, and nor is the backup bucket. Because the Deny stops reads,
  Terraform cannot manage an object in either bucket (creating one reads it
  back). Guard: the exceptions assert and the signals assert in
  `ci_reads_no_secret_or_user_data` (`terraform/envs/prod/tests/guards.tftest.hcl`).
- **The brain's backup bucket never gets a rule that expires or moves current
  versions.** pgBackRest expires backups by count; an age rule would delete the
  only backup after a run of failed nights. Its Object Lock stays COMPLIANCE,
  7 days. Guard: `brain_backups_are_locked_and_never_expire`.
- **The brain's Postgres image tag is immutable and pinned** in Terraform
  (`brain_pg_image_tag` in `brain.auto.tfvars`); the repository refuses a push
  to an existing tag, so publish a new tag and change the setting, never
  retag. Guard: `brain_postgres_image_is_immutable`.
- **The brain's instance role** (`logjam-brain`) holds only the grants in
  `brain_iam.tf`: no audit bucket, no secret beyond the app database,
  origin-verify and Resend, no write to `release.json`, and no AWS-managed
  broad policy. Its inline policies are managed exclusively; its managed
  attachments are not, because AWS Budgets attaches the cost-ceiling deny to
  it and an exclusive resource would detach that at the next apply. Guard:
  `brain_role_has_only_its_grants`.
- **The brain's timers never start the `aws` CLI.** `release-agent.sh` and
  `status.sh` make their S3 calls with `s3_get` and `s3_put` in `brain/host/lib.sh`
  (`curl --aws-sigv4`): a CLI start costs 66 MB and 0.65 s of CPU on a `t4g.micro`, three times a
  minute. Guard: the "never start the aws CLI" check in `brain/tests/e2e.sh`.
- **The Postgres image** (`brain/postgres/`) is what local dev runs and what
  prod's database will run. Its `postgresql.conf` keeps row values and
  statement parameters out of logs; `brain/postgres/tests/test.sh` (CI job
  `brain-postgres`) reads the live settings back. Never give `BRAIN_INIT` a
  default: an empty data directory must stop the container, not create a database.
- **The brain host** (`brain/host/`, `brain/compose.yaml`) holds a database's
  disk. `boot.sh` formats only a device blank to `blkid` and `wipefs` (not "zeros": a new
  encrypted EBS volume reads back non-zero bytes), and starts Postgres with `BRAIN_INIT=bootstrap` only when the
  tag is exactly `1` and the backup repository is positively empty (`pgbackrest
  info` exits 0 for an unreachable one: read its JSON); keep both, and keep
  `create_host_path: false` on the data mount. `brain/tests/e2e.sh` (CI job `brain-e2e`) plays the host's life
  on a loop device; each mutation it names turns it red.
- **The brain's data volume and Elastic IP are never destroyed** (`prevent_destroy`:
  the disk holds the only copy of the database between backups, the address's
  DNS name is in the database certificate). Only the current entry of
  `brain_data_volumes` (in `brain.auto.tfvars`) is attached; replacing a lost disk or zone adds an
  entry and makes it current. An old volume goes only by hand: `terraform
  state rm` of that one instance, delete the volume, then remove its entry
  (removing the entry alone is refused by `prevent_destroy`, and a `removed`
  block cannot name one instance). Changing the current entry replaces the instance at plan
  time (`terraform_data.brain_volume` and `replace_triggered_by`), so the
  recovery applies in one run. Guards: `brain_data_volume_and_address_keep_prevent_destroy`,
  `brain_only_the_current_volume_is_attached_in_its_zone`,
  `brain_instance_is_replaced_when_the_current_volume_changes`.
- **A restore target lives on a volume's entry, never in a setting of its own.**
  `restore_to` (a time with a UTC offset) on the new entry reaches the host as
  `BRAIN_RESTORE_TARGET`, and only a boot onto a blank disk uses it. A variable
  of its own would outlive the disk it was meant for and rewind the next
  restore as well. Leave it on the entry afterwards: removing it changes the
  user data and replaces the host for nothing. Guards:
  `brain_restore_target_comes_only_from_the_current_volume`,
  `brain_restore_to_without_an_offset_is_refused`, scenario 13 of
  `brain/tests/e2e.sh`.
- **Every restore follows its own backup's timeline, and the newest backup is
  always the live database's.** The entrypoint and `drill.sh` pass
  `--target-timeline=current` (Postgres's default follows the newest timeline
  in the archive, which after a rewind is another history), and `boot.sh`
  takes a full backup, before the API starts, when an existing database finds
  the newest backup on another timeline or of another Postgres major. Drop
  either and a second rewind, or a volume made current again, comes back as the
  wrong history with no error. Guards: `postgres/tests/test.sh`, scenarios 13b
  and 14 of `brain/tests/e2e.sh`.
- **A Postgres major upgrade copies and never deletes, and the API waits for
  the new major's full backup.** `postgres/major-upgrade.sh` runs `pg_upgrade`
  in copy mode, never `--link`, and leaves the old cluster at
  `/data/postgres-<N>` for a human to delete; `boot.sh` calls `stanza-upgrade`
  only when the stanza's major differs from the image's (`stanza-create`'s
  refusal of another cluster's stanza stays), and keeps `/data/brain/backup-pending`
  until that full backup succeeds, which `release-agent.sh` honours.
  [0047](../docs/decisions/0047-prod-runs-on-one-self-managed-instance-with-object-lock-backups.md)
  (the Update on the upgrade). Guards: `postgres/tests/test.sh` (the old cluster
  is not linked and survives), scenarios 14 to 14e of `brain/tests/e2e.sh`.
- **The brain's instance exists only while `brain_pg_image_tag` is set** (its
  default is empty; prod's value is in `brain.auto.tfvars`): with it empty, no
  instance, data volume, Elastic IP or alarm is planned
  (`brain_instance.tf`, `brain_alarms.tf`). It requires IMDSv2 (hop limit 2:
  containers use the instance role), has no key pair, and takes its two
  switches as tags (`brain-serving`, `brain-bootstrap`), so flipping one is an
  in-place update. It has no termination protection: the provider does not
  clear it before replacing the instance, which would stop the host and leave
  it down (the data and the address are held by `prevent_destroy` instead). Its credit mode is `unlimited` by default, and `brain_cpu_high`
  (20% for an hour) is what notices a charge. Guards: `brain_is_absent_by_default`,
  `brain_instance_is_locked_down`, `brain_switches_are_in_place_tags`,
  `brain_credit_mode_defaults_to_unlimited`.
- **The brain's host files travel inline in its user data**, so any change to
  `brain/` (outside `postgres/`, `tests/`, `api.env` and the committed
  `brain-ca.pem`, which a commit after first boot must not turn into a
  replacement) or to `brain.env` replaces the
  instance: minutes of downtime, data volume kept, and the signed plan shows it
  as a changed `brain_user_data_sha256`. So those files are in prod's plan
  scope and the apply workflow's paths (`infra/scripts/plan-summary.mjs`,
  `.github/workflows/terraform-apply.yml`; guard: the scope cases in
  `plan-summary.test.mjs`): a PR touching them gets a signed plan and applies on
  merge, and the instance never falls behind `main`. The gzipped script stays under 15,000
  bytes (EC2 refuses 16,384), holds no secret-shaped value, and the keys it
  writes to `brain.env` are the keys the host scripts require. Guards:
  `brain_user_data_stays_within_the_ec2_limit`,
  `brain_host_files_embed_cleanly_and_hold_no_secret`,
  `brain_host_files_leave_out_the_committed_certificate`,
  `brain_env_is_plain_key_value_the_host_files_read`.
- **The restore drill** (`brain/postgres/drill.sh`) restores with
  `--archive-mode=off` and refuses to start Postgres unless the restored
  `archive_mode` reads `off`: a restored copy that archives writes a timeline
  into the live repository and breaks every later restore. Keep both. Guard:
  the drill scenario of `brain/tests/e2e.sh` (the repository listing must not
  change).
- **The brain's watchdog never reads a backup object.** Its role may `GetObject`
  only `status.json` and `drill.json` in the signals bucket and `ListBucket` the
  backup bucket under the WAL archive's prefix; it is the function an alarm and a
  log line hang off, so it stays a step away from user data. Its error
  carries only check codes, its log line those and one HTTP status number. Guard: `brain_watchdog_role_reads_only_the_signals`;
  the prefix must match what the Postgres image writes
  (`brain_watchdog_lists_the_archive_pgbackrest_writes`).
- **The restore drill's task role never writes to the backup bucket**: read and
  list only, and `PutObject` on `drill.json` alone. The drill restores a full
  copy of the database, and a copy that reached into the repository it came from
  (archiving, expiring) would break the thing the drill proves. Its log group has
  no subscription filter, so it never reaches the audit bucket. Guards:
  `brain_drill_role_cannot_write_the_backups`, `brain_drill_log_is_not_the_audit_trail`.
- **The brain's settings are one file, `terraform/envs/prod/brain.auto.tfvars`,
  which Terraform and the deploy workflows both read**
  (`scripts/brain-setting.sh`). Flip a setting by changing its line there:
  never a variable default, `-var` or another tfvars file, which the
  workflows would not see (and `terraform test` loads this file, so the suite
  pins every setting it carries at the top of `guards.tftest.hcl`).
  `brain_serving` needs a tag. Guards:
  `brain_settings_are_one_file_and_read_by_the_workflows`,
  `brain_variable_defaults_are_inert`,
  `brain_serving_without_an_image_tag_is_refused`, and `brain-setting.sh --self-test`.
- **Prod's database and API origin are the brain, whatever the settings say.**
  Every task definition with a `DB_HOST` takes it from `local.db_environment` in
  `ecs.tf` (a new definition takes it, never a literal host), and CloudFront's
  API origin is the brain's Elastic IP name. Neither follows a setting, so a root
  with no brain (empty `brain_pg_image_tag`) does not plan: that is by design.
  `brain_serving` only decides whether the API runs on the host (the instance tag)
  and whether the deploy and rollback workflows wait for the release to be live.
  Guard: `prod_runs_on_the_brain`, and the workflow checks in
  `brain-setting.sh --self-test`.
- **The cost-ceiling deny never covers the brain's backup or signals bucket.**
  AWS Budgets attaches it to the brain's role, which pgBackRest shares with the
  API, so its S3 resources are exactly `logjam-media/*` and `logjam-topo-jobs/*`.
  Guard: `cost_ceiling_denies_only_workers_and_uploads`.
- **The pre sign-up function never sets `autoConfirmUser` or `autoVerifyEmail`,
  and logs nothing from the event** (it carries each person's email). It also
  fails open on any error but the cap. Guards:
  `infra/lambda/cognito-pre-signup/src/index.test.ts`. Its role and the pool's
  `custom_email_sender` are held by `guards.tftest.hcl`.
