# Alarms

Prod's CloudWatch alarms, what fires each one, and what to do first. They
are defined in `infra/terraform/envs/prod/monitoring.tf` and all send to the
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
| `logjam-worker-failures` | Three or more worker tasks (topo, topo export, pre-deploy migrate, place registry, gauges) stopped with a non-zero exit or failed to start within an hour | Read `/aws/events/logjam-worker-failures` for which task, its exit code and ECS's reason, then that worker's own log group |
| `logjam-topo-stuck-task` | Some task in `logjam-cluster` (any family) has been running in every hour of the last six | Find the job, check whether the reaper stopped it, stop the task by hand if not |
| `logjam-place-registry-failed` | The monthly place registry build stopped with a non-zero exit or failed to start | Read `/aws/events/logjam-worker-failures` for its exit code and ECS's reason, then `/ecs/logjam-place-registry` |
| `logjam-place-registry-not-launched` | EventBridge Scheduler's call to start the monthly build returned an error | Check whether a retry started the task anyway; if not, read the `RunTask` error in CloudTrail |
| `logjam-gauges-failed` | The river gauges job stopped with a non-zero exit or failed to start; the published readings are getting older | Read `/aws/events/logjam-worker-failures` for its exit code and ECS's reason, then `/ecs/logjam-gauges` |
| `logjam-gauges-not-launched` | EventBridge Scheduler's call to start the gauges job returned an error | Check whether a retry started the task anyway; if not, read the `RunTask` error in CloudTrail |
| `logjam-rds-free-storage-low` | The database has less than 4 GiB free | Storage autoscaling should grow it; check it did, and what is filling it |
| `logjam-rds-cpu-high` | Database CPU above 90% for 15 minutes | Look for a slow or runaway query, and whether a recent release added it |
| `logjam-pgaudit-delivery-stalled` | No database audit records reached the audit stream in 24 hours | Check the RDS log export and the subscription filter in `infra/terraform/envs/prod/audit.tf` |

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
