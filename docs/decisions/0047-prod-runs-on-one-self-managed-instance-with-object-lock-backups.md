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
   output or a disk snapshot's blocks. There is no SSH: the security group
   admits port 80 from CloudFront and 5432 from the workers only, and the
   operator uses Session Manager. Guards:
   `brain_deploy_role_writes_only_release_json`,
   `ci_reads_no_secret_or_user_data`,
   `brain_security_group_has_two_ingress_rules`,
   `brain_instance_is_locked_down` (no key pair), scenario 6 of `e2e.sh`, and
   the `--self-test` of `brain-release.sh` in the `infra-scripts` CI job. The
   Terraform apply role is broader, because it builds the host: its boundary
   denies it the command output but not the command, and what limits it is
   that only workflows on `main` can assume it and every apply is a plan the
   PR showed ([0035](0035-pr-plans-run-unattended-and-a-main-only-job-signs-them.md)).
6. **Everything is dormant until its setting is flipped.** With the default
   variables there is no instance, volume, address, alarm, watchdog, drill or
   copy task. A built brain still does not serve: its API runs only while the
   instance tag `brain-serving` is exactly `on`, a missing or unreadable tag
   counts as off, and both switches are tags so that flipping one is an
   in-place update, not a replacement. The cutover's copy task is started by
   a person, never on a schedule, and refuses to run against a serving
   brain. Guards: `brain_is_absent_by_default`,
   `brain_watchdog_and_drill_are_absent_by_default`,
   `brain_copy_is_absent_by_default`, `brain_switches_are_in_place_tags`,
   `brain_copy_is_never_scheduled`, `brain_copy_task_reads_only_status_json`,
   and scenarios 5 and 12 of `e2e.sh`.
7. **Clients verify the brain's certificate by name.** The server
   certificate is self-signed for ten years, made at first boot and kept in
   the data directory, so the backups carry it. Its public half is committed
   (as `brain-ca.pem`) and bundled into the API and worker images, and
   clients connect by the Elastic IP's DNS name, never an address:
   `verify-full` in the Python workers, and Prisma's strict mode, which the
   migrate task needs because it ignores `sslrootcert`. Guards: scenario 4 of
   `e2e.sh`, `api/src/lib/databaseUrl.unit.test.ts` and
   `topo/tests/test_worker_helpers.py`.

## Consequences

- **Negative: one host is one point of failure,** and some recoveries need
  the maintainer. Measured on a scratch copy on real AWS, 2026-11-10:
  - A container crash is restarted by Docker in about a second (3 requests
    failed). A Postgres container someone stopped by hand stays stopped until
    `systemctl restart brain-boot`, about 6 seconds.
  - A reboot is back 25 seconds after the call. Failed hardware is EC2's
    automatic recovery, with the same disk and address.
  - A lost data disk or zone is not automatic: the maintainer merges one
    change that adds a volume. The API answered 109 seconds after that apply
    on a 28 MB database and 183 seconds on a 1.7 GB one, the restore itself
    being about 30 seconds. If nobody is around, the API stays down.
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
  API container: 3.2 seconds of failed requests under 40 requests a second
  in one run, and 13.2 seconds in another where pulling a new layer fell
  inside the swap. The host now pulls before it swaps, which was not
  re-measured, so expect a few seconds. Every change to a host file
  replaces the instance, about 3 minutes down with the data volume kept, and
  a size change about 2 minutes.
- **Negative: no horizontal scaling.** The API is one Node process on one
  core. 80 requests a second passed and 100 failed on both sizes, so a bigger
  `t4g` adds memory, not speed. Prod averages about 0.004 a second. Moving
  up a size is the one setting `var.brain_instance_type` and a couple of
  minutes down.
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
  ladder cost about US$0.005. Guard:
  `brain_credit_mode_defaults_to_unlimited_and_alarms_the_surplus` (the alarm
  is what notices a charge).
- **Negative: deleted data lives on in backups.** The weekly rewrite that
  would push a deleted row out of the data files (`pg_repack`) is not built,
  so a deleted row's bytes stay in the live files until overwritten and in
  every kept full backup: eight nightly fulls, then one more day before a
  version is removed. RDS has the same property today: automated backups for
  seven days, and manual snapshots until someone deletes them.
- **Negative: the backups share the host's account and region.** Object Lock
  means no one can delete them early, but a regional failure takes the host
  and its backups' availability together.
- **Negative: the certificate belongs to one brain.** A brain rebuilt from
  nothing with a new Elastic IP needs a new committed certificate and a new
  image; a restore brings the same certificate back inside the backup.
- **Negative: both bills run until RDS and Elastic Beanstalk are removed.**
  The brain was estimated at about US$22 a month on a `t4g.small`, about
  US$8.50 less on the micro (the two on-demand rates' difference), so the
  overlap runs near US$60 a month and `logjam-monthly`'s US$50 alert will
  fire.
- **Positive:** the two big lines go. The recovery point is about 60 seconds
  and is proved every day by a restore, not assumed. Nothing in the data
  path is AWS-only, so the host's Compose files, Postgres, pgBackRest and
  the S3 API move to another provider. What does not: the Elastic IP's DNS
  name (the certificate names it), the instance metadata tags that carry the
  switches, Budgets, the credit mode, Object Lock's semantics, Session
  Manager, and the CloudWatch to Firehose path to the audit bucket.
- **Neutral:** [0001](0001-rds-tls-via-bundled-ca.md) stays true until RDS is
  removed, and removing RDS is when it is superseded. The work this leaves
  for later is the ladder in the runbook, and steps 3 and 4 of it are not
  built. Running the API as more than one process needs two changes first:
  the background sweeps in `api/src/lib/topoJobReaper.ts` must run in one
  process only, because they delete media with no database row, and the rate
  limiter in `api/src/middleware/rateLimit.ts`, which keeps its counters in
  each process's memory, must share them.

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
  release swap with a 1.7 GB database. The small adds about 700 MB of headroom for about US$8.50 a
  month and no speed. Rejected on the maintainer's call; moving up is one
  setting.
- **Standard CPU credit mode.** Throttles to the baseline (0.4 vCPU on a
  small): measured with the quota emulated, p95 crossed 500 ms at about 17
  requests a second (15 held) against 80 with burst. Rejected for `unlimited`, accepting the worst case above.
- **WAL-G instead of pgBackRest.** Compared on paper only. pgBackRest passed
  every requirement in a spike on real S3 with Object Lock (archiving, full
  backups, expiry by delete marker, restore after expiry, a restore as of a
  past time, backups by a non-superuser), so WAL-G was not built.
