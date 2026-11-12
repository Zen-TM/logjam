# Alarms

Prod's CloudWatch alarms, what fires each one, and what to do first. They
are defined in `infra/terraform/envs/prod/monitoring.tf` (the brain's, in
`brain_alarms.tf` and `brain_watchdog.tf`) and all send to the
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
| `logjam-signup-cap-80-percent` | Sign-ups this month reached 80% of the monthly cap | Is it growth or a flood? Raise the cap or leave it ([Sign-up cap](#sign-up-cap)) |
| `logjam-signup-trigger-errors` | The pre sign-up function returned an error: the cap is full, or the trigger is broken | Compare the month's count with the cap; if under it, read the function's log group ([Sign-up cap](#sign-up-cap)) |
| `logjam-pgaudit-delivery-stalled` | No database audit records reached the audit stream in 24 hours | Check the brain's Postgres log group (`/logjam/brain/postgres`) and its subscription filter in `infra/terraform/envs/prod/brain_logs.tf`, then the delivery stream in `audit.tf` |
| `logjam-brain-system-status-failed` | AWS's system status check on the brain (the EC2 host) failed for 2 minutes; EC2 is recovering it onto new hardware | Wait for the OK email, then confirm the API answers and Postgres is up (the brain section below) |
| `logjam-brain-instance-status-failed` | The brain's own status check failed for 10 minutes; it is being rebooted | Wait for the OK email. If it comes back failing, open a Session Manager shell and read why |
| `logjam-brain-cpu-credits-low` | The brain's CPU credit balance has been under 30 for 30 minutes (standard credit mode only) | Find what is using the CPU; at zero the brain is throttled to its baseline |
| `logjam-brain-cpu-high` | The brain's CPU has averaged 20% or more for an hour | Find out what is using the CPU (growth, one client misbehaving, or a runaway process). Above the free allowance it costs cents; at 50% the API is three quarters of the way to its limit of about 80 requests a second, and a bigger instance of the same family adds memory, not speed |
| `logjam-brain-checks-failing` | The brain's outside check (a Lambda every 5 minutes) failed in two of the last three runs | Read the function's latest log line for the codes that failed, then the table under it in the brain section below |
| `logjam-brain-watchdog-not-running` | The outside check has not run for 15 minutes, so nothing is watching the brain | Check the EventBridge rule `logjam-brain-watchdog` is enabled and the function exists, then read its log group |
| `logjam-ceiling` (an AWS Budget, not a CloudWatch alarm) | Actual spend this month reached US$100 before tax, and AWS attached a deny policy to the brain's role | New worker jobs fail and uploads are refused. Find what ran the bill up, then undo the deny ([Cost ceiling](#cost-ceiling)) |

## API

### `logjam-api-5xx`

A metric filter counts every line of the API's request log (pino-http, in the
brain's group `/logjam/brain/api`) whose `res.statusCode` is 500 or more, as
metric `Responses5xx` in namespace `Logjam/Api`.

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
writes no log line. The watchdog's `api_unready` and the EC2 status-check alarms
cover that ([The brain](#the-brain)).

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
the `logjam-workers` security group, a public IP. Neither alarm notices a
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

## Sign-up cap

Cognito bills a user as active for the month they sign up, confirmed or not,
and nothing in front of its endpoints limits how fast an account can be
created. So a pre sign-up function (`infra/lambda/cognito-pre-signup`) counts
self-service sign-ups in the DynamoDB table `logjam-signup-counter` (one item
per UTC month, attribute `n`) and refuses them once `signup_cap_per_month`
(`infra/terraform/envs/prod/cognito_signup_cap.tf`, 9000) is reached. People
already signed up are untouched, and so are accounts an administrator creates.
Both clients tell a refused person "Logjam isn't taking new accounts right now.
Try again next month." The count starts again on the 1st (UTC).

If the counter cannot be reached, the sign-up goes through uncounted rather
than fail, so a DynamoDB outage can let a few past the cap but never blocks
anyone.

### `logjam-signup-cap-80-percent`

A metric filter on the function's log group reads each `signup_counted` line
(`n` this month, `cap`) as `SignupsThisMonth` in namespace `Logjam/Signup`.
The alarm fires when the day's highest count reaches 80% of the cap. The metric
only has a point when a sign-up is counted, and once the cap is full none are,
so the alarm holds its state through quiet days instead of clearing. After the
1st it clears at the first counted sign-up of the new month, not at midnight; if
nobody signs up, it stays up.

1. See the count: `aws dynamodb get-item --table-name logjam-signup-counter
   --key '{"month":{"S":"2026-11"}}'` (use the current UTC month). The item
   holds a number and nothing else.
2. Real growth: the cap is already 9000, the ceiling of the free tier:
   Cognito's 10,000 free active users a month also have to cover people who
   sign in. Going higher is a billing decision, not a quick fix: it takes a PR
   that changes `signup_cap_per_month` and the variable's validation in
   `cognito_signup_cap.tf` together with its guard in `guards.tftest.hcl`
   (`signup_cap_variable_stays_inside_the_free_tier`). Check the user pool's
   active users first. (If someone lowered the cap, raising it back up to 9000
   is an ordinary PR whose apply changes the function's environment only.)
3. A flood: leave the cap. At the cap it stops the bill, at the price of
   closing sign-ups until the 1st.

### `logjam-signup-trigger-errors`

The function's `Errors` metric above zero. A refusal is a thrown error, so this
also fires when the cap is full; a broken trigger fails real sign-ups the same
way, which is why it alarms.

1. Read the count (above). At the cap, that is the cause: nothing to fix.
2. Under the cap, read `/aws/lambda/logjam-cognito-pre-signup` (it logs
   counts and error class names, never who signed up) for a crash or a
   timeout. If a deploy just changed the function, revert that PR.
3. A person who must get in while the cap is full: create their account as an
   administrator (Cognito console, the user pool, Create user, or
   `aws cognito-idp admin-create-user`). That path is never counted or refused.

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
credits-low alarm only in standard credit mode. Do not test the two status
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

### `logjam-brain-cpu-credits-low`

Only exists when `brain_cpu_credits` is `standard`. The instance earns CPU
credits and spends them above its baseline; at zero it is held to the
baseline, which slows the API and Postgres together. The alarm fires when the
balance averages under 30 for six readings in a row (30 minutes).

1. Find the cause (the steps under `logjam-brain-cpu-high`).
2. If the load is real, switch to `unlimited` credits or a bigger instance type.

### `logjam-brain-cpu-high`

One alarm covers both the API running hot and the bill. The brain runs in
unlimited credit mode (`brain_cpu_credits`, the default): it never throttles,
and CPU beyond the free allowance is billed at US$0.04 per vCPU-hour. The
allowance is 10% of the instance on a `t4g.micro` (0.2 vCPU of two) and 20% on
a `t4g.small`. Idle is about 3% of the instance (the whole host used 0.066 of
two vCPUs over ten idle minutes, measured on a scratch copy, 2026-11-11), and a
daily full backup or a boot does not bring an hour to 20% (the busiest hour of
that rehearsal, with a boot, a data load and a load test in it, averaged
17.5%), so the alarm fires when one hour averages 20% or more. A month in which no
hour reaches that costs a `t4g.micro` at most about US$5.84 in surplus credits. It is one reading of an hour on purpose:
several shorter readings that must all be high would miss a load that rests
between bursts.

How much traffic that is: on a scratch copy (2026-11-10), 20, 40, 60 and 80
requests a second used 21, 36, 50 and 64% of the instance. The API is one Node
process, so it uses one of the two vCPUs and saturates near 80 requests a
second (it failed at 100). At 50% it is three quarters of the way there.

1. Find out what is using the CPU, by `top` in a Session Manager shell and the
   API's request log in `/logjam/brain/api` (by client and path): growth, one
   client misbehaving, or a runaway process such as a stuck query (`docker exec`
   into Postgres and `select * from pg_stat_activity`), a restore, or a backup
   running at the same time as traffic.
2. A one-off is fine. A steady load means the instance is near its limit. A
   bigger instance of the same family adds memory, not speed; compare the cost
   with the next size up before changing.

### `logjam-brain-checks-failing`

The brain tells the world how it is doing by writing `status.json` every
minute, but a machine that is down cannot say so. So a small function, the
watchdog (`infra/lambda/brain-watchdog`), looks from outside every 5 minutes:
at that report, at the backup bucket, at the restore drill's report and at the
public API. A run that finds anything wrong fails on purpose, and the alarm
fires when two of the last three runs failed, so a single blip does not email.

**Which checks failed:** open the log group `/aws/lambda/logjam-brain-watchdog`
and read the latest line. It is `{"failed": ["wal_stale", ...]}`: codes only,
never any data. While the brain is not serving, the line also has
`"ready_probe"`: the HTTP status the public `/ready` answered to one try, or
`null` if it could not connect. Any status but `403` shows the firewall lets
the watchdog through; a `403` means it does not.
The probe never fails a run. Then find each code below. The same line also shows when the
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
| `memory_low` | Postgres is up and the host has under 100 MiB available (or `status.json` does not say). On a `t4g.micro` the lowest seen in a rehearsal was 164 under a release swap with a 1.7 GB database, 331 idle | The host is close to running out of memory: move `brain_instance_type` in `brain.auto.tfvars` up one size (about two minutes of downtime) |
| `drill_missing` | The restore drill has never written `drill.json`. **Expected for up to a day after the brain first comes up**: the drill runs once a day at 04:30 Sydney | If it is still missing after the first 04:30, look in ECS (`logjam-cluster`) for a `logjam-brain-drill` task and read `/logjam/brain/drill` |
| `drill_stale` | `drill.json` is more than 50 hours old: the drill stopped running | Is the schedule `logjam-brain-drill` enabled? Did its tasks start (ECS, `logjam-cluster`)? Read `/logjam/brain/drill` |
| `drill_failed` | The latest drill ran and said it failed: a backup that does not restore. Treat as urgent | Read `drill.json` (`aws s3 cp s3://<signals bucket>/drill.json -`): `error` names the step (`no_backup`, `restore_failed`, `timed_out`, ...), no data. Then `/logjam/brain/drill`. If the disk was too small, raise `brain_drill_storage_gb` (its default in `brain_variables.tf`). `replay_short` means the restore replayed none of the recent WAL: if the brain was down or restoring around the drill's time, that outage is the cause and the next drill (or one run by hand) clears it; otherwise the archive has a hole after the last full backup, or the drill cannot read it, so read `/logjam/brain/drill` and take a full backup now, so a restore no longer depends on the missing WAL |
| `api_unready` | The brain says it is serving, but `https://api.logjamnsw.com/ready` did not answer 200 twice in a row | `curl -i https://api.logjamnsw.com/ready` yourself. If it fails, `docker ps` and `docker logs --tail 50 brain-api-1` on the brain; a bad release is rolled back as in [rollback.md](rollback.md) |

`wal_stale`, `status_*` and `postgres_down` can all fire together when the
host goes down: start with the status-check alarms.

There is no code for how stale a restore came up. That number is the age of the
newest restored data when recovery ends, so it is the outage plus the loss: any
real recovery takes more than five minutes, and a check would stay red for a day
after every one, hiding other failures. For a rewind to a chosen time it is
measured from that time instead, so it says how stale the data was at the
target. `last_restore_lag_seconds` stays in `status.json` for the recovery
runbook ([brain.md](brain.md)).

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

## Cost ceiling

`infra/terraform/envs/prod/budget_breaker.tf` holds a second AWS Budget,
`logjam-ceiling`: US$100 a month, before tax (`var.cost_ceiling_usd`). It
emails `logjam-budget-alerts` at 80% of actual spend and at 100% forecast. At
100% of actual spend, AWS Budgets itself attaches the managed policy
`logjam-cost-ceiling-deny` to the role `logjam-brain`,
with no approval step and no code of ours running. It is the backstop under the
compute pool's polite refusals and should never fire in a normal month. The
earlier warning is `logjam-monthly` in `budgets.tf`, which includes tax and is
US$50.

Two more polite refusals sit beside the compute pool, each a site-wide sum over
every account. `SITE_STORAGE_BYTES` (default 500 GiB, in `lib/storageQuota.ts`)
refuses an upload that would take all stored bytes past it, and
`SITE_MONTHLY_EGRESS_BYTES` (default 300 GiB, in `lib/egressQuota.ts`) refuses
an export or file download once everyone's downloads this month have passed it.
Both answer 429 with a sentence that does not blame the user, `0` turns one off,
and either is changed in `infra/brain/api.env` (not set there today). The
download total comes from the egress meter, which reads S3 access logs hours
late, so it overshoots by that much. No alarm watches them: a refusal logs the
warn line `site_storage_cap_reached` or `site_egress_cap_reached`, and a metric
filter on it is the way to add one.

The policy denies `ecs:RunTask` on every task definition and `s3:PutObject` on
`logjam-media` and `logjam-topo-jobs`, nothing else. So:

- Starting a LiDAR job, an export or any other worker from the API fails, and
  so does creating or finishing an upload, including a presigned URL already
  handed out, because S3 checks the signer when the URL is used. The user
  sees an error where they would otherwise have seen a polite refusal.
- Everything already stored is untouched. Downloads and reads work, jobs
  already running finish, and the brain's backups and signals bucket are never
  denied.

The budget's figures lag by hours, so the breaker is late by design: spend can
pass the ceiling before it acts.

1. Find what spent the money: Cost Explorer grouped by service, then by usage
   type, for this month.
2. Stop it at the source. Raising the ceiling alone does not lift the deny.
3. Undo the deny with AWS Budgets, not by detaching the policy by hand, so it
   knows the action was reversed. In the console: Budgets → `logjam-ceiling` →
   Action history → Reverse. Or with the CLI (`<id>` is `ActionId` in the first
   command's output):

   ```sh
   aws budgets describe-budget-actions-for-budget \
     --account-id 620853681701 --budget-name logjam-ceiling
   aws budgets execute-budget-action --account-id 620853681701 \
     --budget-name logjam-ceiling --action-id <id> \
     --execution-type REVERSE_BUDGET_ACTION
   ```

   A reversed action is not evaluated again for the rest of the month; choose
   Reset in the console if it should re-arm.
4. A Terraform apply does not lift the deny: Terraform does not manage which
   managed policies are attached to `logjam-brain`, so
   the block stays until the action is reversed.
