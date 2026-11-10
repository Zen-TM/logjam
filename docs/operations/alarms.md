# Alarms

Prod's CloudWatch alarms, what fires each one, and what to do first. They
are defined in `infra/terraform/envs/prod/monitoring.tf` (the brain's, in
`brain_alarms.tf`) and all send to the
`logjam-alerts` SNS topic (`ap-southeast-2`), which emails the maintainer
when an alarm fires and again when it clears. Every alarm's email repeats
its first step and links here.

Nothing here pages by SMS or phone: an alarm is an email, read when someone
next looks. A broken API release is normally caught sooner, by the deploy's
smoke test and automatic rollback ([rollback.md](rollback.md)); these alarms
are the backstop for what that misses: a rollback that also failed, a
release that passes its smoke test but fails real requests, and anything
that goes wrong between deploys.

| Alarm | Fires when | First response |
|---|---|---|
| `logjam-api-5xx` | The API logged 10 or more 5xx responses in two of the last three 5-minute windows | Did a deploy just run? If its smoke test failed, check the automatic rollback finished. If a release is to blame, roll it back |
| `logjam-api-environment-degraded` | Elastic Beanstalk reported the API environment Degraded or Severe in every minute for 10 minutes | Read the environment's health causes. If a deploy just ran, roll it back. Otherwise look for a crash loop in the API log |
| `logjam-worker-failures` | Three or more worker tasks (topo, topo export, pre-deploy migrate, place registry, gauges, fire history, coverage) stopped with a non-zero exit or failed to start within an hour | Read `/aws/events/logjam-worker-failures` for which task, its exit code and ECS's reason, then that worker's own log group |
| `logjam-topo-stuck-task` | Some task in `logjam-cluster` (any family) has been running in every hour of the last six | Find the job, check whether the reaper stopped it, stop the task by hand if not |
| `logjam-place-registry-failed` | The monthly place registry build stopped with a non-zero exit or failed to start | Read `/aws/events/logjam-worker-failures` for its exit code and ECS's reason, then `/ecs/logjam-place-registry` |
| `logjam-place-registry-not-launched` | EventBridge Scheduler's call to start the monthly build returned an error | Check whether a retry started the task anyway; if not, read the `RunTask` error in CloudTrail |
| `logjam-gauges-failed` | The river gauges job stopped with a non-zero exit or failed to start; the published readings are getting older | Read `/aws/events/logjam-worker-failures` for its exit code and ECS's reason, then `/ecs/logjam-gauges` |
| `logjam-gauges-not-launched` | EventBridge Scheduler's call to start the gauges job returned an error | Check whether a retry started the task anyway; if not, read the `RunTask` error in CloudTrail |
| `logjam-fire-history-failed` | The monthly fire history build stopped with a non-zero exit or failed to start | Read `/aws/events/logjam-worker-failures` for its exit code and ECS's reason, then `/ecs/logjam-fire-history` |
| `logjam-fire-history-not-launched` | EventBridge Scheduler's call to start the monthly fire history build returned an error | Check whether a retry started the task anyway; if not, read the `RunTask` error in CloudTrail |
| `logjam-coverage-failed` | The monthly coverage build stopped with a non-zero exit or failed to start | Read `/aws/events/logjam-worker-failures` for its exit code and ECS's reason, then `/ecs/logjam-coverage` |
| `logjam-coverage-not-launched` | EventBridge Scheduler's call to start the monthly coverage build returned an error | Check whether a retry started the task anyway; if not, read the `RunTask` error in CloudTrail |
| `logjam-rds-free-storage-low` | The database has less than 4 GiB free | Storage autoscaling should grow it; check it did, and what is filling it |
| `logjam-rds-cpu-high` | Database CPU above 90% for 15 minutes | Look for a slow or runaway query, and whether a recent release added it |
| `logjam-pgaudit-delivery-stalled` | No database audit records reached the audit stream in 24 hours | Check the RDS log export and the subscription filter in `infra/terraform/envs/prod/audit.tf` |
| `logjam-brain-system-status-failed` | AWS's system status check on the brain (the EC2 host) failed for 2 minutes; EC2 is recovering it onto new hardware | Wait for the OK email, then confirm the API answers and Postgres is up (the brain section below) |
| `logjam-brain-instance-status-failed` | The brain's own status check failed for 10 minutes; it is being rebooted | Wait for the OK email. If it comes back failing, open a Session Manager shell and read why |
| `logjam-brain-cpu-surplus-credits-charged` | The brain was charged for surplus CPU credits (unlimited credit mode, the default) | Find what is using the CPU; the worst case is about US$47 a month on a `t4g.small` |
| `logjam-brain-cpu-credits-low` | The brain's CPU credit balance has been under 30 for 30 minutes (standard credit mode only) | Find what is using the CPU; at zero the brain is throttled to its baseline |
| `logjam-brain-checks-failing` | The brain's outside check (a Lambda every 5 minutes) failed in two of the last three runs | Read the function's latest log line for the codes that failed, then the table under it in the brain section below |
| `logjam-brain-watchdog-not-running` | The outside check has not run for 15 minutes, so nothing is watching the brain | Check the EventBridge rule `logjam-brain-watchdog` is enabled and the function exists, then read its log group |

## API

### `logjam-api-5xx`

A metric filter counts every line of the API's request log (pino-http, in the
Elastic Beanstalk group
`/aws/elasticbeanstalk/logjam-api-prod/var/log/eb-docker/containers/eb-current-app/stdouterr.log`)
whose `res.statusCode` is 500 or more, as metric `Responses5xx` in namespace
`Logjam/Api`.

Why these numbers: one phone whose sync keeps failing retries on a backoff
from 1 second to 5 minutes, so it sends about ten requests in its first few
minutes and then one every few minutes. It can fill one window, not two. A
broken release fails every request from every open copy of Logjam GPS and
Logjam Web, and fills every window while anyone uses it.

1. Did a deploy just run (GitHub → Actions → Deploy API)? If its smoke test
   failed, check the automatic rollback ran and passed.
2. Find the failing requests: CloudWatch → Logs Insights on the group above,
   `filter res.statusCode >= 500 | stats count(*) by req.url` (paths only; the
   log never holds query strings).
3. If one release is to blame, roll it back ([rollback.md](rollback.md)).

It cannot see an API that is not running at all, because a dead container
writes no log line. The next alarm covers that.

### `logjam-api-environment-degraded`

Elastic Beanstalk's enhanced health rolls the instance, the container and
the share of failing requests into one status. The alarm fires when it has
been Degraded or Severe for ten minutes. A deploy restarts the API cold and
shows Severe for a minute or two, which is why the window is ten.

1. Read why: Elastic Beanstalk console → `logjam-api-prod` → Health, or
   `aws elasticbeanstalk describe-environment-health --environment-name logjam-api-prod --attribute-names All`.
2. If a deploy just ran, roll it back ([rollback.md](rollback.md)).
3. Otherwise read the end of the API log group above for a crash repeating
   on every start.

## Workers

### `logjam-worker-failures`

An EventBridge rule copies every ECS "task stopped" event from
`logjam-cluster` into the log group `/aws/events/logjam-worker-failures`
when the task exited non-zero or never started (an image it could not pull,
a secret it could not read). Stops the reaper asks for are left out. A
metric filter counts them as `FailedTasks` in namespace `Logjam/Workers`.

Every failed job exits non-zero, so one bad upload is one failure. Three in
an hour means a broken worker or a user retrying something that keeps
failing; either is worth a look. Jobs are rare, so a broken worker image can
take hours to reach three: each user is told their job failed in the
meantime.

1. Read `/aws/events/logjam-worker-failures`: `detail.group` names the
   family, `detail.containers[0].exitCode` the exit code (137 is an
   out-of-memory kill), `detail.stoppedReason` what ECS saw.
2. Read the family's own log group, `/ecs/<family>`, around that time.
3. If a worker deploy just ran, roll the worker back
   ([rollback.md](rollback.md)).

A maintainer announcement runs on the `logjam-api-script` family and
exits 1 when the script refuses a message, cannot find one to retract, or
fails ([announcements.md](announcements.md)). Its event carries the
announce command in `detail.overrides`; that failure is the script's, not
the worker's, so there is nothing to roll back. The one-off purge of legacy
LiDAR jobs ([purge-legacy-topo-jobs.md](purge-legacy-topo-jobs.md)) runs on
the same family and exits 1 when a job fails to delete; it too has nothing to
roll back, and a rerun picks up the failed jobs.

### `logjam-topo-stuck-task`

Made by hand before Terraform owned monitoring and adopted as it was.
Despite its name it watches the whole cluster: the most tasks running in each
hour has been above zero for six hours in a row. The reaper
(`api/src/lib/topoJobReaper.ts`) fails a job that runs too long and stops its
task; this alarm is for a task it missed. It also fires if jobs simply run
back to back for six hours.

1. Find the running tasks in ECS (`logjam-cluster`), their families, and the
   job each runs (the `JOB_ID` in its overrides).
2. Check the reaper logged a sweep of that job in the API log.
3. Stop the task by hand if it is still running:
   `aws ecs stop-task --cluster logjam-cluster --task <task arn> --reason "stuck"`.

## Place registry

The place registry ([0034](../decisions/0034-location-search-reads-a-public-osm-place-registry.md))
is rebuilt by the ECS task `logjam-place-registry`, which EventBridge
Scheduler starts at 04:00 Sydney time on the 5th of each month. A failed
build publishes nothing: the registry under `master/places/` stays as it
was, a month older. Run it again by hand once the cause is fixed: ECS →
`logjam-cluster` → Run new task, family `logjam-place-registry`, Fargate,
the `logjam-worker-sg` security group, a public IP. Neither alarm notices a
schedule that is deleted or disabled; Terraform owns it, so a plan shows that
as drift.

### `logjam-place-registry-failed`

A metric filter on `/aws/events/logjam-worker-failures` (see
[`logjam-worker-failures`](#logjam-worker-failures)) counts this family's
failed stops as `PlaceRegistryFailures` in namespace `Logjam/Workers`. It runs
once a month, so one failure fires.

1. Read `/aws/events/logjam-worker-failures`: `detail.containers[0].exitCode`
   (137 is an out-of-memory kill) and `detail.stoppedReason`.
2. Read `/ecs/logjam-place-registry`. "refusing to publish" means the new
   build was much smaller than the live one, usually a truncated download of
   Geofabrik's extract: run it again. Anything else is a bug in
   `topo/build_place_registry.py` or the topo worker image; if a worker
   deploy just ran, roll the worker back ([rollback.md](rollback.md)).

### `logjam-place-registry-not-launched`

EventBridge Scheduler's `TargetErrorCount` for the `default` schedule group,
which holds only this schedule. Any error fires, including one a retry then
got past, since the next scheduled run is a month away.

1. Look in ECS for a `logjam-place-registry` task started after the alarm;
   if one ran, this was a passing error.
2. If none ran, find the `RunTask` call by the role
   `logjam-place-registry-scheduler` in CloudTrail and read its error: a role,
   subnet or task definition problem, fixed in Terraform.

## Testing an alarm

To check an alarm still reaches the email, force its state. The next
evaluation puts it back.

```sh
aws cloudwatch set-alarm-state --region ap-southeast-2 \
  --alarm-name logjam-api-5xx --state-value ALARM --state-reason "test"
```

The email arrives within a minute or so, then an OK email when the alarm
re-evaluates. If none arrives, check the topic's subscription is confirmed:
`aws sns list-subscriptions-by-topic --topic-arn <topic arn>` (the topic is
the only thing here Terraform does not fully own: its email subscription
was made by hand).

## River gauges

The river gauge files ([0044](../decisions/0044-river-gauges-are-public-files-from-waternsw-and-bom.md))
are written by the ECS task `logjam-gauges`, which EventBridge Scheduler starts
every two hours from its own schedule group. A run that fails before publishing
(key, no hot readings, refusing to publish) leaves
`master/gauges/v1/latest.json` as it was, and clients show its age. A cold
sweep that fails part way publishes the hot readings first, then exits
non-zero. The
task reads WaterNSW's key from the Secrets Manager secret
`logjam/waternsw-api-key`, whose value is set by hand. Its quota is 29 calls a
day: do not start extra runs.

### `logjam-gauges-failed`

A metric filter on `/aws/events/logjam-worker-failures` counts the task's
non-zero exits and failed starts.

1. Read `/aws/events/logjam-worker-failures`: `detail.containers[0].exitCode`
   and `detail.stoppedReason`. "ResourceInitializationError ... secret" means
   the secret has no value yet, or the execution role cannot read it.
2. Read `/ecs/logjam-gauges`. "WATERNSW_API_KEY is not set" or a 401 means the
   key is missing or expired: put a new value in the secret. "returned no
   usable hot readings" means WaterNSW answered with nothing: wait for the next
   run. "refusing to publish" means `topo/gauges.json` lost most of its gauges.
   "the cold sweep failed part way" means one of the daily sweep's calls
   failed: the hot readings were still published and the sweep stopped to
   save the quota. If no chunk got through, the next run sweeps again; if
   some did, the rest wait for tomorrow.
3. Do not rerun by hand in a loop: each run spends calls from the day's 29.

### `logjam-gauges-not-launched`

EventBridge Scheduler's `TargetErrorCount` for the `logjam-gauges` schedule
group. Any target error alarms, including one a retry got past.

1. Look in ECS for a `logjam-gauges` task started after the alarm; if one ran,
   this was a passing error.
2. If none ran, find the `RunTask` call by the role `logjam-gauges-scheduler` in
   CloudTrail and read its error: a role, subnet or task definition problem,
   fixed in Terraform.

## Fire history

The raster the vegetation layer marks burnt ground from,
`fire/fire_history_year.tif` in the topo bucket, is rebuilt by the ECS task
`logjam-fire-history`, which EventBridge Scheduler starts at 04:00 Sydney on
the 5th of each month from its own schedule group. It reads NPWS's map
service and does nothing when the service's polygon count and latest dates
match the published legend's (`fire/fire_history_year_legend.json`). A run
that fails uploads nothing, so the published raster stays as it was, a
month older.

### `logjam-fire-history-failed`

A metric filter on `/aws/events/logjam-worker-failures` counts this family's
failed stops as `FireHistoryFailures` in namespace `Logjam/Workers`. It runs
once a month, so one failure fires.

1. Read `/aws/events/logjam-worker-failures`: `detail.containers[0].exitCode`
   (137 is an out-of-memory kill) and `detail.stoppedReason`.
2. Read `/ecs/logjam-fire-history`. "not building from a partial read" means
   fewer polygons arrived than the service counts, or the service changed
   while it was read; "query failed" lines before it name the HTTP error.
   "refusing to publish" means the service now holds far fewer dated
   polygons than the published build. Either way, check the service answers
   (`topo/README.md`, "Refreshing the fire history") and run the task again
   by hand. Anything else is a bug in `topo/build_fire_history.py` or the
   topo worker image; if a worker deploy just ran, roll the worker back
   ([rollback.md](rollback.md)).

### `logjam-fire-history-not-launched`

EventBridge Scheduler's `TargetErrorCount` for the `logjam-fire-history`
schedule group. Any target error alarms, including one a retry got past,
since the next scheduled run is a month away.

1. Look in ECS for a `logjam-fire-history` task started after the alarm; if
   one ran, this was a passing error.
2. If none ran, find the `RunTask` call by the role
   `logjam-fire-history-scheduler` in CloudTrail and read its error: a role,
   subnet or task definition problem, fixed in Terraform.

## Coverage

The Coverage overlay's archive, `master/coverage/nsw-coverage.pmtiles` in the
topo bucket, is rebuilt by the ECS task `logjam-coverage`, which EventBridge
Scheduler starts at 04:00 Sydney on the 6th of each month from its own
schedule group. It asks data.gov.au for the ACCC's coverage release and does
nothing when the latest year's maps are the ones the published state
(`master/coverage/nsw-coverage.json`) lists. A run that fails uploads
nothing, so the published archive stays as it was.

### `logjam-coverage-failed`

A metric filter on `/aws/events/logjam-worker-failures` counts this family's
failed stops as `CoverageFailures` in namespace `Logjam/Workers`. It runs
once a month, so one failure fires.

1. Read `/aws/events/logjam-worker-failures`: `detail.containers[0].exitCode`
   (137 is an out-of-memory kill) and `detail.stoppedReason`.
2. Read `/ecs/logjam-coverage`. "has only ... maps" means a carrier's
   Outdoor or Ext Ant map is missing from the latest year: the ACCC is
   mid-upload, and next month's run will build. "has nothing in the box"
   means a map downloaded empty or truncated; "failed, retrying" lines name
   an HTTP error. Run the task again by hand once data.gov.au answers
   (`topo/README.md`, "Refreshing the coverage overlay"). Anything else is a
   bug in `topo/build_coverage.py` or the topo worker image; if a worker
   deploy just ran, roll the worker back ([rollback.md](rollback.md)).

### `logjam-coverage-not-launched`

EventBridge Scheduler's `TargetErrorCount` for the `logjam-coverage`
schedule group. Any target error alarms, including one a retry got past,
since the next scheduled run is a month away.

1. Look in ECS for a `logjam-coverage` task started after the alarm; if one
   ran, this was a passing error.
2. If none ran, find the `RunTask` call by the role `logjam-coverage-scheduler`
   in CloudTrail and read its error: a role, subnet or task definition
   problem, fixed in Terraform.

## The brain

These alarms exist only while the brain's EC2 instance does
(`infra/terraform/envs/prod/brain_alarms.tf` and `brain_watchdog.tf`), and the
two credit alarms only for the credit mode in use. Do not test the two status
alarms with `set-alarm-state`: their actions recover or reboot the host.

### `logjam-brain-system-status-failed`

EC2's system status check covers what AWS runs under the instance: power,
network and the physical host. When it fails for two minutes the alarm asks
EC2 to recover the instance, which restarts it on other hardware with the same
disks, address and tags (EC2 also does this by default). The API and Postgres
are down until it is back, a few minutes.

1. Wait for the OK email.
2. Check the API answers (`/ready` through CloudFront) and, in a Session
   Manager shell, that `docker ps` shows `brain-postgres-1` healthy. The boot
   unit starts Postgres again by itself.
3. If it does not come back, the instance has to be replaced, which any change
   to its user data does (a PR touching `infra/brain/`). The data volume is
   separate and is reattached.

### `logjam-brain-instance-status-failed`

The instance status check covers the operating system: a hung kernel, a full
disk, a broken network configuration. After ten minutes the alarm reboots the
instance. Docker stops Postgres cleanly on the way down and the boot unit
starts it again.

1. Wait for the OK email.
2. If it comes back failing, open a Session Manager shell and read
   `journalctl -b -u brain-boot` and `df -h /`.

### `logjam-brain-cpu-surplus-credits-charged`

The brain runs in unlimited credit mode (`brain_cpu_credits`, the default).
It never throttles, and it is billed US$0.04 per vCPU-hour for the CPU it uses
beyond its baseline (20% of each core on a `t4g.small`, 10% on a `t4g.micro`).
The worst case, both cores pinned all month, is about US$47 a month on a
`t4g.small` and US$53 on a `t4g.micro`. Any charge in an hour fires the alarm,
which is how a charge gets noticed at all: it appears on the bill only.

1. Find the cause: a runaway query (`docker exec` into Postgres and
   `select * from pg_stat_activity`), a restore, or a backup running at the same
   time as traffic.
2. A one-off is fine. A steady charge means the instance is too small for the
   load: compare the charge with the next size up before changing.

### `logjam-brain-cpu-credits-low`

Only exists when `brain_cpu_credits` is `standard`. The instance earns CPU
credits and spends them above its baseline; at zero it is held to the
baseline, which slows the API and Postgres together. The alarm fires when the
balance averages under 30 for six readings in a row (30 minutes).

1. Find the cause as above.
2. If the load is real, switch to `unlimited` credits or a bigger instance type.

### `logjam-brain-checks-failing`

The brain tells the world how it is doing by writing `status.json` every
minute, but a machine that is down cannot say so. So a small function, the
watchdog (`infra/lambda/brain-watchdog`), looks from outside every 5 minutes:
at that report, at the backup bucket, at the restore drill's report and at the
public API. A run that finds anything wrong fails on purpose, and the alarm
fires when two of the last three runs failed, so a single blip does not email.

**Which checks failed:** open the log group `/aws/lambda/logjam-brain-watchdog`
and read the latest line. It is `{"failed": ["wal_stale", ...]}`: codes only,
never any data. Then find each code below. The same line also shows when the
alarm clears (`{"failed": []}`).

The shell steps need a Session Manager shell on the brain
(`aws ssm start-session --target <instance id>`). Containers are
`brain-postgres-1` and `brain-api-1`.

| Code | What it means | First thing to do |
|---|---|---|
| `status_missing` | The function could not read `status.json` from the signals bucket: the brain has not written one yet, or cannot | Is the instance running (EC2 console)? In a shell, `journalctl -u brain-status -n 50` shows why the status timer fails |
| `status_stale` | `status.json` was last written more than 3 minutes ago: the host is down or its status timer stopped | As `status_missing`. If the instance is stopped or unreachable, see the two status-check alarms above |
| `status_invalid` | `status.json` is not valid JSON or its `schema` is not 1 | Someone changed `infra/brain/host/status.sh` without the watchdog. Read the file (`aws s3 cp s3://<signals bucket>/status.json -`) and fix whichever side is wrong |
| `boot_failed` | The boot unit's mode is `failed` or `refused`: Postgres was not started on purpose or by mistake | `journalctl -b -u brain-boot`. `refused` means a blank data disk with no backup and no permission to create a database; never set `brain_bootstrap` just to silence it |
| `postgres_down` | Postgres is not answering, and no restore is running | `docker ps` and `docker logs --tail 50 brain-postgres-1`. The boot unit restarts it; `systemctl restart brain-boot` if it does not |
| `disk_high` | The data disk is 80% full (or its usage could not be read) | `df -h /data`, then what is big: `du -sh /data/postgres/pg_wal` is the usual suspect when archiving is stuck (see `wal_stale`). A full disk stops Postgres; grow the volume (`brain_data_volumes`) before it fills |
| `wal_stale` | Postgres is up, but no new WAL has reached the backup bucket for 5 minutes. A restore from now would lose everything since. This is the one check that can catch a backup that has silently stopped, and it does not trust the brain's own report | `docker logs --tail 50 brain-postgres-1` and look for `archive-push` errors (an expired role, S3 unreachable, bucket policy). Once fixed, run `systemctl start brain-backup-full`: if archiving was stuck for hours, the safety limit may have dropped WAL, and until a new full backup exists a restore would stop at the gap while every other check looks green |
| `full_stale` | The newest full backup is more than 26 hours old (or there is none) | `journalctl -u brain-backup-full -n 100`, then `systemctl start brain-backup-full` |
| `restore_lag_high` | The last restore (in the past day) came up more than 5 minutes behind: the copy was staler than the 60-second goal | Check `wal_stale` was not also failing, then take a fresh full backup (`systemctl start brain-backup-full`). Only a restore sets this, so it clears itself a day later |
| `drill_missing` | The restore drill has never written `drill.json`. **Expected for up to a day after the brain first comes up**: the drill runs once a day at 04:30 Sydney | If it is still missing after the first 04:30, look in ECS (`logjam-cluster`) for a `logjam-brain-drill` task and read `/logjam/brain/drill` |
| `drill_stale` | `drill.json` is more than 50 hours old: the drill stopped running | Is the schedule `logjam-brain-drill` enabled? Did its tasks start (ECS, `logjam-cluster`)? Read `/logjam/brain/drill` |
| `drill_failed` | The latest drill ran and said it failed: a backup that does not restore. Treat as urgent | Read `drill.json` (`aws s3 cp s3://<signals bucket>/drill.json -`): `error` names the step (`no_backup`, `restore_failed`, `timed_out`, ...), no data. Then `/logjam/brain/drill`. If the disk was too small, raise `brain_drill_storage_gb` |
| `api_unready` | The brain says it is serving, but `https://api.logjamnsw.com/ready` did not answer 200 twice in a row | `curl -i https://api.logjamnsw.com/ready` yourself. If it fails, `docker ps` and `docker logs --tail 50 brain-api-1` on the brain; a bad release is rolled back as in [rollback.md](rollback.md) |

`wal_stale`, `status_*` and `postgres_down` can all fire together when the
host goes down: start with the status-check alarms.

### `logjam-brain-watchdog-not-running`

The check that watches the brain must itself be watched. This alarm fires when
the function was not invoked at all in 15 minutes (missing data counts), which
means the schedule or the function is gone, not that the brain is unhealthy.

1. In the EventBridge console check the rule `logjam-brain-watchdog` is
   enabled and has the function as its target.
2. Check the function `logjam-brain-watchdog` exists and read its log group for
   the last run.
3. If both look right, run the function once from the Lambda console and see
   what it logs.
