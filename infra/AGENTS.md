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
  zips is built: `cd infra/lambda/cognito-email-sender && npm ci && npm run build`.
- **Change AWS and the repository's GitHub settings only through Terraform,**
  never the console, the CLI or GitHub's Settings pages: what is made by hand
  is drift the next plan undoes. Secret values, the two settings Apps and
  private vulnerability reporting are set by hand (0025).
- **A new secret** is an `aws_secretsmanager_secret` with no version in
  Terraform; its value is set by hand and tasks read the resource's `.arn`. A
  literal ARN is only for a secret made outside Terraform.
- **CI owns deploy-time fields:** image revisions (`infra/scripts/pin-ecs-task-image.sh`),
  the EB environment's `setting`s and the frontend bucket's contents. Terraform
  ignores them; never make it manage them.
- **A plan that destroys or replaces a stateful resource** (RDS, S3, Cognito,
  CloudFront, EB) is a stop: ask. Never remove `prevent_destroy` to get past one.
- **The CI roles' privacy Deny** (`local.ci_readonly_privacy_deny` in
  `terraform/envs/prod/iam.tf`) stays on every read-only role and in the apply
  role's boundary: CI never reads user data, audit objects, logs or secret
  values. Objects in this account's buckets and log events are denied by
  default; a bucket CI must read objects from is added to the Deny's
  exceptions and to its guard.
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
  (`var.brain_pg_image_tag`); the repository refuses a push to an existing tag,
  so publish a new tag and change the variable, never retag. Guard:
  `brain_postgres_image_is_immutable`.
- **The brain's instance role** (`logjam-brain`) holds only the grants in
  `brain_iam.tf`, managed exclusively: no audit bucket, no secret beyond the
  app database, origin-verify and Resend, no write to `release.json`, and no
  AWS-managed broad policy. Guard: `brain_role_has_only_its_grants`.
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
- **The brain's instance exists only while `var.brain_pg_image_tag` is set**:
  with the default, no instance, data volume, Elastic IP or alarm is planned
  (`brain_instance.tf`, `brain_alarms.tf`). It requires IMDSv2 (hop limit 2:
  containers use the instance role), has no key pair, and takes its two
  switches as tags (`brain-serving`, `brain-bootstrap`), so flipping one is an
  in-place update. It has no termination protection: the provider does not
  clear it before replacing the instance, which would stop the host and leave
  it down (the data and the address are held by `prevent_destroy` instead). Its credit mode is `unlimited` by default, and the surplus
  alarm is what notices a charge. Guards: `brain_is_absent_by_default`,
  `brain_instance_is_locked_down`, `brain_switches_are_in_place_tags`,
  `brain_credit_mode_defaults_to_unlimited_and_alarms_the_surplus`.
- **The brain's data volume and Elastic IP are never destroyed** (`prevent_destroy`:
  the disk holds the only copy of the database between backups, the address's
  DNS name is in the database certificate). Only the current entry of
  `var.brain_data_volumes` is attached; replacing a lost disk or zone adds an
  entry and makes it current, and a later change drops the old one with a
  `removed` block. Changing the current entry replaces the instance at plan
  time (`terraform_data.brain_volume` and `replace_triggered_by`), so the
  recovery applies in one run. Guards: `brain_data_volume_and_address_keep_prevent_destroy`,
  `brain_only_the_current_volume_is_attached_in_its_zone`,
  `brain_instance_is_replaced_when_the_current_volume_changes`.
- **A restore target lives on a volume's entry, never in a setting of its own.**
  Rewinding past bad data is the disk-loss change with `restore_to` (a time
  with a UTC offset) on the new entry; it reaches the host as
  `BRAIN_RESTORE_TARGET` and only a boot onto a blank disk uses it. A variable
  of its own would outlive the disk it was meant for and rewind the next
  restore as well. The old volume stays detached with the data as it was before
  the rewind. A restore follows the newest backup, and the newest backup is
  always of the live database's timeline: every restore passes
  `--target-timeline=current` (the entrypoint and `drill.sh`), and `boot.sh`
  takes a full backup when an existing database finds the newest backup on
  another timeline. So a second rewind, earlier or later, works as written, and
  making the old volume current again is safe: that is how a rewind is undone.
  Guards: `postgres/tests/test.sh`, scenario 13b of `brain/tests/e2e.sh`,
  `brain_restore_target_comes_only_from_the_current_volume`,
  `brain_restore_to_without_an_offset_is_refused`, and the point-in-time
  scenario of `brain/tests/e2e.sh`.
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
  into the live repository and breaks every later restore. Keep both, and keep
  the drill's role read-only on the backup bucket. Guard: the drill scenario of
  `brain/tests/e2e.sh` (the repository listing must not change).
- **The cutover's data copy** (`brain/postgres/copy.sh`, `brain_copy.tf`) is
  started by a person, never on a schedule, and never against a serving brain:
  it stops unless `status.json` is fresh and says `serving` is false (read
  before the dump and again before the restore), because a copy then replaces
  live data with RDS's frozen copy. Keep both reads, keep certificate
  verification on both ends, and keep its task role to `s3:GetObject` on
  `status.json`. Guards: `brain_copy_is_never_scheduled`,
  `brain_copy_task_reads_only_status_json`, and the copy scenario of
  `brain/tests/e2e.sh`.
