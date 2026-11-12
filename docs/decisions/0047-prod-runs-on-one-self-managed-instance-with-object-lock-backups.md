# 0047. Prod's API and Postgres run on one self-managed instance, backed up to an Object Lock bucket, with no control plane

- **Date:** 2026-11-10
- **Status:** Accepted
- **Supersedes:** —

## Context

Until now prod is an Elastic Beanstalk instance (Docker platform, `t3.micro`)
running the API, and a single-AZ RDS `db.t3.micro` it reaches over verified
TLS ([0001](0001-rds-tls-via-bundled-ca.md)). October's bill, measured:

| Line | US$ |
|---|---|
| RDS | 24.60 |
| Elastic Beanstalk's instance | 9.82 |
| Public IPv4 | 3.76 |
| EBS | 1.20 |
| **These four, of a US$46 month** | **39.38** |

The load is small: 21 users and about 360 API requests a day, with the
Elastic Beanstalk instance at 1 % CPU and RDS at 5 %, holding about 1.7 GB.
Three things forced a change:

- **The bill.** The two biggest lines are one database and one API instance
  that are each almost idle.
- **The recovery point.** After losing its volume, RDS can lose up to about
  five minutes of writes (its point-in-time recovery window is seven days).
  The target here is about one minute.
- **Not re-architecting at a user threshold.** The parts that hold data or
  run code should be plain and portable: Postgres, container images run by
  Docker Compose, S3-compatible storage, configuration in environment
  variables. Moving provider is then a restore, not a rewrite.

The design is `infra/brain/` (the Compose files, the host scripts, the
Postgres image) and `infra/terraform/envs/prod/brain_*.tf`, with the
watchdog in `infra/lambda/brain-watchdog/`. "The brain" is the one instance.
It was measured on a scratch copy on real AWS (2026-11-10): a `t4g.micro`
running Postgres with TLS, pgaudit and WAL archiving beside the API passes
80 requests a second (p95 269 ms) and fails at 100, on CPU: one Node process
uses one core. A `t4g.small` fails at the same rate.

Everything merges dormant: with the default settings nothing exists, so the
change costs nothing until someone turns it on, and the cutover from RDS is
a separate, announced window.

## Decision

Prod's API and its Postgres run on **one self-managed EC2 instance** under
Docker Compose, with **pgBackRest backups in an Object Lock bucket**, and
**no control plane**: no controller, autoscaling group, load balancer or
credential broker. These rules hold the decision up, and each names what
fails when it is broken.

1. **One instance, with its data on a volume Terraform cannot destroy.** The
   brain is one plain `aws_instance` (arm64, no autoscaling group). Its root
   disk is disposable. Postgres lives on `/data`, a separate encrypted
   volume, and that volume and the Elastic IP carry `prevent_destroy`.
   Replacing a lost disk or zone adds an entry to `var.brain_data_volumes`
   and makes it current; the old volume is kept, which is the undo. The
   instance requires IMDSv2, has no key pair, and has **no termination
   protection**: the AWS provider does not clear it before replacing the
   instance, so the apply would stop the host and fail (found on the scratch
   copy). The size is a setting, `var.brain_instance_type`, not an
   architecture: the maintainer chose `t4g.micro` on 2026-11-10, in
   `unlimited` CPU credit mode. Guards, in
   `infra/terraform/envs/prod/tests/guards.tftest.hcl`:
   `brain_instance_is_locked_down`,
   `brain_only_the_current_volume_is_attached_in_its_zone`,
   `brain_instance_is_replaced_when_the_current_volume_changes`,
   `brain_instance_sizes_set_postgres_and_api_memory`, and
   `brain_data_volume_and_address_keep_prevent_destroy`, which reads the
   source because a plan shows no lifecycle rules. `prevent_destroy` stops
   Terraform only: nothing stops a delete in the console. No test fails if
   an autoscaling group is added; review holds that.
2. **Only `infra/brain/host/boot.sh` starts Postgres, and it never makes a
   database over data or over a repository it cannot read.** It formats a
   device only when `blkid` and `wipefs` both see nothing. A data directory
   with a database is started. An absent one is restored if the backup
   repository holds a backup; it is created only when the instance tag
   `brain-bootstrap` is exactly `1` **and** the repository is positively
   empty, read from `pgbackrest info`'s JSON because that command exits 0
   for a repository it cannot reach; otherwise boot refuses. The image has
   no default for `BRAIN_INIT`, and the data mount has
   `create_host_path: false`. Guards: scenarios 1, 3, 8, 8c and 10 of
   `infra/brain/tests/e2e.sh`, each mutation named in its header, and
   `infra/brain/postgres/tests/test.sh` for the image.
3. **Backups are WAL every minute and a full backup every night, in a bucket
   that cannot be overwritten or emptied early.** pgBackRest pushes WAL with
   `archive_timeout = 60`, plus a canary row updated and `pg_switch_wal()`
   called once a minute, because `archive_timeout` alone stays quiet for up
   to five minutes after a crash recovery or a restore. A full backup runs
   at 03:00 Sydney time and eight are kept. The bucket is versioned with
   Object Lock in COMPLIANCE mode for 7 days. No lifecycle rule expires or
   moves a current version, because pgBackRest expires by count and an age
   rule would delete the only backup after a run of failed nights. The
   brain's role may add objects and delete markers but never delete a
   version or change retention. Guards:
   `brain_backups_are_locked_and_never_expire`,
   `brain_role_has_only_its_grants`, scenario 8b of `e2e.sh` (the canary),
   and the watchdog's `test_wal_stale` and `test_full_stale` in
   `infra/lambda/brain-watchdog/test_handler.py` (WAL older than 5 minutes,
   a full older than 26 hours). No test pins the 03:00 timer or the count
   of eight in `infra/brain/postgres/pgbackrest-conf.sh`.
4. **A restore is proven daily by a drill that cannot write to the
   repository.** At 04:30 Sydney time a Fargate task restores the newest
   backup onto its own disk with `--archive-mode=off`, starts Postgres with
   no network port, reads every table (counts discarded) and writes
   `drill.json`, a fixed set of keys, to the signals bucket. Its role may
   read and list the backups and write that one object; it has no ingress and
   its log group never reaches the audit bucket. The watchdog fails when the
   verdict is missing, older than 50 hours or not ok. Both layers stay:
   a restored copy that promotes and archives writes a timeline into the
   live repository and breaks every later restore, and the scratch copy
   showed it is the option, not the role, that holds. Guards: scenario 11 of
   `e2e.sh` (the repository listing must not change),
   `brain_drill_role_cannot_write_the_backups`,
   `brain_drill_runs_daily_after_the_backup_on_arm`,
   `brain_drill_log_is_not_the_audit_trail`, and the watchdog's
   `test_drill_missing`, `test_drill_stale` and `test_drill_failed`.
5. **CI never gets a shell on the host, and a release is a pointer file.**
   `.github/workflows/deploy-api.yml` writes `release.json` (an image sha and
   the API's non-secret settings) to the signals bucket after the migrate
   task; a timer on the host makes the running API match it, and refuses
   anything that is not a sha and plain `KEY=value` lines
   (`infra/scripts/brain-release.sh` and `infra/brain/host/release-agent.sh`
   share one set of patterns). The deploy role may write that one object and
   push the one image; no CI role reads either brain bucket, a command's
   output or a disk snapshot's blocks, and **no CI role can start a session,
   send a command or open a shell on the host or in a task**: that is denied to
   the plan role, the deploy role, the contributor group and the Terraform
   apply role's boundary alike, and only the maintainer's own identity can.
   There is no SSH: the security group admits port 80 from CloudFront and 5432
   from the workers only, and the operator uses Session Manager. Guards:
   `brain_deploy_role_writes_only_release_json`,
   `ci_reads_no_secret_or_user_data`,
   `brain_security_group_has_two_ingress_rules`,
   `brain_instance_is_locked_down` (no key pair), scenario 6 of `e2e.sh`, and
   the `--self-test` of `brain-release.sh` in the `infra-scripts` CI job. The
   Terraform apply role is administrative, because it builds the host, but
   inside a boundary that carries the same Deny; only workflows on `main` can
   assume it, and every apply is a plan the PR showed
   ([0035](0035-pr-plans-run-unattended-and-a-main-only-job-signs-them.md)).
6. **Everything is dormant until its setting is flipped.** With the default
   variables there is no instance, volume, address, alarm, watchdog or drill.
   A built brain still does not serve: its API runs only while the
   instance tag `brain-serving` is exactly `on`, a missing or unreadable tag
   counts as off, and both switches are tags so that flipping one is an
   in-place update, not a replacement. Guards: `brain_is_absent_by_default`,
   `brain_watchdog_and_drill_are_absent_by_default`,
   `brain_switches_are_in_place_tags`, and scenario 5 of `e2e.sh`. (Updated
   2026-11-11: the cutover's copy task, its guards and its scenario 12 are
   removed with the cutover, and `brain_is_dormant_for_cloudfront_and_tasks`
   went with the settings it read; see the Update below.)
7. **Clients verify the brain's certificate by name.** The server
   certificate is self-signed for ten years, made at first boot and kept in
   the data directory, so the backups carry it. Clients connect by the
   Elastic IP's DNS name, never an address, and verify it: `verify-full` in
   the Python workers, and Prisma's strict mode, which the migrate task needs
   because it ignores `sslrootcert`. Built now, with these guards: scenario 4
   of `e2e.sh`, `api/src/lib/databaseUrl.unit.test.ts`,
   `api/src/lib/dbConnection.unit.test.ts` and
   `topo/tests/test_worker_helpers.py`. Not built until a later change: the
   certificate's public half is committed as `brain-ca.pem` (it cannot exist
   before the brain has booted) and bundled at `/app/brain-ca.pem` into the API
   image and the topo worker image. Until then, with serving on, a task fails
   at start and never falls back to an unverified connection. The committed
   file is left out of the host files, so committing it does not replace the
   instance (`brain_host_files_leave_out_the_committed_certificate`).
8. **One settings file, flipped one line at a time.** The switches live in
   `infra/terraform/envs/prod/brain.auto.tfvars`, which Terraform and the
   deploy and rollback workflows both read (the workflows through
   `infra/scripts/brain-setting.sh`, which fails rather than guess), so they
   cannot disagree about the mode. In order: the image tag, the bootstrap
   flag, `brain_serving` (the instance tag, and the workflows' wait for the
   release to be live). `brain_serving` needs a tag, and the refusal names the
   setting. (Updated 2026-11-11: a further `brain_public` setting, which
   CloudFront's API origin followed, is gone; the origin and the task
   definitions' database name the brain unconditionally. See the Update
   below.) Guards: `brain_settings_are_one_file_and_read_by_the_workflows`,
   `brain_variable_defaults_are_inert`,
   `brain_serving_without_an_image_tag_is_refused`, and `brain-setting.sh
   --self-test` (`infra-scripts`).
9. **A restore follows the newest backup, and a rewind is a new volume.** A
   restore target (`restore_to`, a time with a UTC offset) lives on a data
   volume's entry in `var.brain_data_volumes`, never in a setting of its own:
   only the current volume's reaches the host, only a blank disk restores to
   it, and a target the archive cannot reach ends boot mode `failed` with
   nothing serving, not a database promoted somewhere else. Every restore
   passes `--target-timeline=current`, and an existing database whose
   timeline is not the newest backup's takes a full backup at boot, so the
   newest backup is always the live database's and a later restore follows
   it, whichever of two volumes came back. The old volume is kept: it is the
   undo. Guards: `brain_restore_target_comes_only_from_the_current_volume`,
   `brain_restore_target_reaches_the_host_from_the_current_volume`,
   `brain_restore_to_without_an_offset_is_refused`,
   `brain_restore_to_must_be_a_real_time`, and scenarios 13 and 13b of
   `e2e.sh`.
10. **The host's timers never start the AWS CLI.** The release and status
    timers sign their own S3 requests with `curl`: the CLI cost 66 MB and
    0.67 s of CPU a call on a `t4g.micro`, against 17.9 MB and 0.10 s
    (measured). Guard: the check "one release tick and one status tick never
    start the aws CLI" in scenario 7 of `e2e.sh`.

- **Update 2026-11-11: Elastic Beanstalk and RDS are removed, and the brain is
  the only API and database.** The cutover happened and the maintainer chose
  against the 30-day waiting period the cutover issue (#434) suggested:
  Logjam is in beta with no promise to its users, so the old stack went once a
  regression and smoke sweep of prod on the brain had passed. What changes
  above: the `brain_public` setting is gone, so CloudFront's API origin and
  every task definition's database (`local.db_environment`) name the brain
  unconditionally, whatever `brain_serving` says (guard
  `prod_runs_on_the_brain`); `brain_serving` stays as the switch for the API on
  the host (the instance tag, and the workflows' wait for the release to be
  live); the deploy and rollback workflows have no Elastic Beanstalk step; the
  copy task (`brain_copy.tf`, `copy.sh`) is deleted, so rule 6's "refuses a
  serving brain" is no longer a rule, and the sweeps' two-database hazard it
  guarded against cannot recur; and TLS is
  [0048](0048-database-connections-verify-the-brains-certificate-and-never-fall-back-to-plain.md),
  which supersedes 0001. A brain rebuilt when there is none gets its data from
  the backups, never a copy (`docs/operations/brain.md`). RDS's automated
  backups and its final snapshot are not kept, so no copy of a deleted
  account's data outlives the instance. What still holds this decision up: one
  instance on a volume Terraform cannot destroy, backups in an Object Lock
  bucket and the daily restore, no control plane, the certificate checked by
  name, and the CI privacy Deny (updated 2026-11-12: its `rds:` and
  `elasticbeanstalk:` actions, kept at first though both services were gone,
  are removed with the last of the old stack; a database service added later
  brings its own Deny). Everything else above stands.

- **Update 2026-11-12: a database of an older Postgres major is upgraded before
  it is started.** Moving the image from 16 to 18 meets a rule above: a server
  refuses another major's data directory, so "a data directory with a database
  is started" (rule 2) gains a step. When `/data/postgres/PG_VERSION` is older
  than the pinned image's `PG_MAJOR`, `infra/brain/host/boot.sh` stops Postgres and runs
  `infra/brain/postgres/major-upgrade.sh` in a one-off container (`upgrade` in
  `compose.yaml`, which is why that container mounts all of `/data`).
  `pg_upgrade` runs in copy mode into `/data/postgres.new`; one atomic
  exchange and a rename leave the old cluster at `/data/postgres-<N>`, which no
  script deletes. Then the stanza is moved (`stanza-upgrade`, only when its
  major differs: `stanza-create` still refuses another cluster's stanza) and a
  full backup of the new major is taken before the API starts, because until
  then the newest backup is one the image cannot restore: a marker on the data
  volume, `/data/brain/backup-pending`, written before the upgrade and removed
  after that backup, keeps `infra/brain/host/release-agent.sh` from starting the API,
  whatever the boot did. Any failure fails the boot and
  starts nothing; data of a newer major than the image is refused; and a server
  start on another major's directory, including a restored old backup, stops
  with a message (`brain-entrypoint.sh`). Equal majors start no extra container.
  The image carries the old major's binaries only for this, and they go once
  prod is on the new one; restoring from before an upgrade needs the image tag
  of that time. Guards: scenarios 14 and 14b of `e2e.sh`, and the major-version
  guard and upgrade checks in `infra/brain/postgres/tests/test.sh`. What still holds the
  decision up: boot.sh is the only thing that starts Postgres, and it never
  deletes a cluster. Everything else above stands.

## Consequences

- **Negative: one host is one point of failure,** and some recoveries need
  the maintainer. Measured on a scratch copy on real AWS, 2026-11-10:
  - A container crash is restarted by Docker in about a second (3 requests
    failed). A Postgres container someone stopped by hand stays stopped until
    `systemctl restart brain-boot`, about 6 seconds.
  - A reboot is back 25 seconds after the call. Failed hardware is EC2's
    automatic recovery, with the same disk and address.
  - A lost data disk or zone is not automatic: the maintainer merges one
    change that adds a volume. The API answered 109 to 196 seconds after that
    one apply on a 28 MB database (196 on the finished stack, 2026-11-11) and
    183 seconds on a 1.7 GB one, the restore itself being about 30 seconds.
    If nobody is around, the API stays down.
  - The loss is about a minute while archiving is healthy. No acknowledged
    row was lost in four of the five disk-loss runs, and 42 seconds (4 rows)
    were lost in the one where the repository was unreachable as the old
    host shut down. A disk loss with an unarchived tail on a running host
    was not produced, so the bound rests on the newest WAL object never
    being older than 60 seconds across ten minutes of writes.
  - After pgBackRest drops WAL (an archiving stall of about nine hours fills
    its 8 GiB queue), `info`, `check` and `verify` stay green and a restore
    stops at the gap. Accepted: the stall alarms at 5 minutes, the nightly
    full closes the gap, and a restore reports how stale it came up
    (`last_restore_lag_seconds`). There is no automatic gap detection.
- **Negative: deploys and host changes have a gap.** A release recreates the
  API container. Measured on the finished stack under 40 requests a second
  (2026-11-11): under a second when idle, and with traffic 462 failed
  requests over 13.1 seconds, because the old API kept waiting for open
  keep-alive connections that never went idle until Docker killed it after its
  10-second stop timeout. With the shutdown fix in #875 (every response ends
  its connection once shutdown has begun) the same swap failed 151 requests
  over 3.8 seconds, which is the figure to expect once it is merged (it
  should be before the cutover). The host pulls the new image before it
  stops the old one, so the pull is no longer inside the gap (measured).
  Every change to a host file replaces the instance: 165 seconds down in one
  apply, with the data volume kept. A size change takes about 2 minutes.
- **Negative: no horizontal scaling.** The API is one Node process on one
  core. 80 requests a second passed and 100 failed on both sizes, so a bigger
  `t4g` adds memory, not speed. Prod averages about 0.004 a second. Moving
  up a size is the one setting `var.brain_instance_type` and a couple of
  minutes down. The first step towards more than one API process is done:
  the background sweeps run in one process per database, held by a Postgres
  advisory lock (`api/src/lib/sweepLeader.unit.test.ts` and
  `api/src/__tests__/sweepLeader.test.ts`). The rate limiter's counters, in
  each process's memory, are not.
- **Negative: the host files are 90 % of what EC2 allows.** They travel in the
  instance's user data, 14,718 bytes gzipped of EC2's 16,384 (updated
  2026-11-12: 13,839 before the major upgrade step in `infra/brain/host/boot.sh`), and a guard
  stops at 15,000 (`brain_user_data_stays_within_the_ec2_limit`). The way out is to
  move them into the brain's Postgres image, which already carries the Compose
  plugin.
- **Negative: the operator now has root on the database host,** through
  Session Manager. [`DATA-ACCESS-POLICY.md`](../DATA-ACCESS-POLICY.md) says
  what is and is not recorded; root can read the data files or stop the
  audit shipping, which RDS did not allow.
- **Negative: the API's role can read the backups.** Containers use the
  instance role through the metadata service (hop limit 2), as the API does on
  Elastic Beanstalk, so a compromised API could read every backup, add
  objects, and hide current versions behind delete markers. Object Lock
  stops deleting or overwriting a version for 7 days, not reading it; the
  versions stay readable with `--repo-target-time`, which is why the role
  has `s3:ListBucketVersions`. Every read is an audit-trail event.
- **Negative: the image is pinned to one Debian release.** Physical backups
  carry indexes built under that release's collation, so moving
  `infra/brain/postgres/Dockerfile` to another release needs a reindex plan
  first. Nothing tests the pin: this paragraph is the guard.
- **Negative: unlimited CPU credits have a worst-case bill.** About US$53 a
  month on a `t4g.micro` (US$47 on a small) with both cores pinned all month,
  at US$0.04 per vCPU-hour above the baseline. Measured, the whole load
  ladder cost about US$0.005. One CPU alarm notices it: an hour averaging
  20 % or more, and a month with no such hour costs a micro at most about
  US$5.84. Guards: `brain_credit_mode_defaults_to_unlimited` and
  `brain_alarms_act_on_the_instance`.
- **Negative: deleted data lives on in backups.** The weekly rewrite that
  would push a deleted row out of the data files (`pg_repack`) is not built,
  so a deleted row's bytes stay in the live files until overwritten and in
  every kept full backup: eight nightly fulls, then one more day before a
  version is removed. RDS had the same property: automated backups for
  seven days, and manual snapshots until someone deleted them (updated
  2026-11-11: it is deleted, with both).
- **Negative: the backups share the host's account and region.** Object Lock
  means no one can delete them early, but a regional failure takes the host
  and its backups' availability together.
- **Negative: the certificate belongs to one brain.** A brain rebuilt from
  nothing with a new Elastic IP needs a new committed certificate and a new
  image; a restore brings the same certificate back inside the backup.
- **Negative: both bills ran until RDS and Elastic Beanstalk were removed
  (updated 2026-11-11: they are).**
  The brain was estimated at about US$22 a month on a `t4g.small`, US$7.74
  less on the micro (Sydney on-demand, US$0.0212 against US$0.0106 an hour),
  so about US$14, and the overlap runs near US$60 a month: `logjam-monthly`'s
  US$50 alert will fire.
- **Positive:** the two big lines go. The recovery point is about 60 seconds
  and is proved every day by a restore, not assumed. Nothing in the data
  path is AWS-only, so the host's Compose files, Postgres, pgBackRest and
  the S3 API move to another provider. What does not: the Elastic IP's DNS
  name (the certificate names it), the instance metadata tags that carry the
  switches, Budgets, the credit mode, Object Lock's semantics, Session
  Manager, and the CloudWatch to Firehose path to the audit bucket.
- **Neutral:** [0001](0001-rds-tls-via-bundled-ca.md) stayed true until RDS was
  removed; [0048](0048-database-connections-verify-the-brains-certificate-and-never-fall-back-to-plain.md)
  superseded it (updated 2026-11-11). The work this leaves
  for later is the ladder in the runbook, and steps 3 and 4 of it are not
  built. Running the API as more than one process still needs the rate
  limiter in `api/src/middleware/rateLimit.ts`, which keeps its counters in
  each process's memory, to share them; the sweeps in
  `api/src/lib/topoJobReaper.ts`, which delete media with no database row,
  already run in one process.

## Alternatives considered

- **Stay on RDS and Elastic Beanstalk.** The obvious option, and it has
  what this one gives up: someone else runs the database host and its
  backups, and the operator has no shell on it. Rejected because RDS and the
  API's instance were US$34.42 of a US$46 month for 21 users, its recovery
  point is five minutes, and the database cannot leave AWS without
  re-platforming it.
- **The full design in #432, #565 and #566:** a controller (Lambda and Step
  Functions), an autoscaling group, HAProxy with the API on its own
  instance, a credential broker, and a scratch environment with fault
  injection. Rejected on 2026-11-10 after measuring: its own cost table
  saved about US$2 a month against today's bill, where this design saves an
  estimated US$17 to 25, and for 21 users the controller is recurring cost,
  upkeep and risk. Designed and deliberately not built, so not to be rebuilt
  in passing: the controller, epochs and fencing, the autoscaling group,
  HAProxy, the credential broker, the scratch environment, the weekly
  `pg_repack`, and a CloudWatch agent. If a second host is ever wanted, those
  issues are the starting point.
- **Start on a `t4g.small`.** Weighed by running both on real AWS: the micro
  passed every step it was meant to, with no out-of-memory kill and no
  container restart even overloaded, its lowest free memory 164 MiB under a
  release swap with a 1.7 GB database. The small adds about 700 MB of headroom for US$7.74 a
  month and no speed. Rejected on the maintainer's call; moving up is one
  setting.
- **Standard CPU credit mode.** Throttles to the baseline (0.4 vCPU on a
  small): measured with the quota emulated, p95 crossed 500 ms at about 17
  requests a second (15 held) against 80 with burst. Rejected for `unlimited`, accepting the worst case above.
- **For the major upgrade: `pg_upgrade --link`, or a dump and restore.** Link
  mode is faster and needs no free space, and the official 18 image's layout
  (`/var/lib/postgresql/18/docker`) is made for it, but it leaves the old
  cluster unusable once the new server has run, so it is no rollback; a
  `pg_dump`/restore keeps the old cluster but takes a long outage on a large
  database, and a restore of the repository's newest backup under the new
  server is impossible. Rejected for copy mode between two directories of the
  data volume, which is why the image sets `PGDATA` to the path every mount
  here uses instead of 18's default.
- **WAL-G instead of pgBackRest.** Compared on paper only. pgBackRest passed
  every requirement in a spike on real S3 with Object Lock (archiving, full
  backups, expiry by delete marker, restore after expiry, a restore as of a
  past time, backups by a non-superuser), so WAL-G was not built.
