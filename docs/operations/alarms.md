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
| `logjam-worker-failures` | Three or more worker tasks (topo, topo export, GeoPDF, pre-deploy migrate) stopped with a non-zero exit or failed to start within an hour | Read `/aws/events/logjam-worker-failures` for which task, its exit code and ECS's reason, then that worker's own log group |
| `logjam-topo-stuck-task` | Some task in `logjam-cluster` (any family) has been running in every hour of the last six | Find the job, check whether the reaper stopped it, stop the task by hand if not |
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
