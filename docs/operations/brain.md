# The brain: running it

The brain is Logjam's API and its Postgres on one EC2 instance. It replaces
Elastic Beanstalk and RDS; until the cutover
([brain-cutover.md](brain-cutover.md)) it runs beside them, serving nobody.
Why it is built this way, and the rules that hold it up:
[ADR 0047](../decisions/0047-prod-runs-on-one-self-managed-instance-with-object-lock-backups.md).

- **One instance** (`logjam-brain`, a `t4g.micro`) under Docker Compose: a
  Postgres container and an API container. The data is on its own encrypted
  disk, mounted at `/data`; the root disk can be thrown away.
- **Backups** are pgBackRest, into a bucket nobody can empty for 7 days: WAL
  every minute, a full backup at 03:00 Sydney time, eight kept. A scheduled
  task restores the newest one every day at 04:30 and says whether it worked.
- **Releases** are a file: CI writes `release.json` to a bucket, a timer on the
  host makes the running API match it. CI never has a shell on the host, and
  neither does anyone but the maintainer, through Session Manager (no SSH).
- **Everything is a setting** in `infra/terraform/envs/prod/brain.auto.tfvars`,
  flipped one line at a time by a merge. Until its line is flipped a thing does
  not exist, and a built brain does not serve.
- **An outside check** (a Lambda every 5 minutes) and a few CloudWatch alarms
  email the maintainer; [alarms.md](alarms.md) says what each one means.

Every command below is complete and says what to look for. Each is marked
**run on a scratch copy** (a rehearsal on a throwaway copy of the brain on real
AWS, 2026-11-10; its timings are quoted as measured there) or **not yet run
anywhere**. Prod's numbers will differ with the size of the database. Use the
maintainer's AWS credentials and `export AWS_REGION=ap-southeast-2`.

**Never read user data to diagnose anything.** Look at counts, names, logs and
sizes. A session or command is recorded with who started it, and a read through
the database is recorded by pgaudit
([the policy](../DATA-ACCESS-POLICY.md)).

## Where to look

| What | Where | Tells you |
|---|---|---|
| The host's own report | `s3://logjam-brain-signals-620853681701/status.json`, written every minute | Postgres up, disk, free memory, newest WAL and full backup, the running API's sha, whether it serves, how the last boot went |
| The restore drill's verdict | `drill.json`, same bucket, written daily | Whether the newest backup restores, and how long it took |
| The outside check | log group `/aws/lambda/logjam-brain-watchdog` | One line per run: `{"failed": [...]}` with codes only |
| The API's log | `/logjam/brain/api` | One line per request (the same fields as the old log, see [queries.md](queries.md)) |
| Postgres's log, with pgaudit | `/logjam/brain/postgres` | Statements without values; this is also what reaches the audit bucket |
| The drill's log | `/logjam/brain/drill` | Table names only |
| Alarms | email, and [alarms.md](alarms.md#the-brain) | What each code means and what to do first |

Read the status file (run on a scratch copy; only the maintainer's own
credentials can, because CI and the brain's own role cannot):

```sh
aws s3 cp s3://logjam-brain-signals-620853681701/status.json - | python3 -m json.tool
```

Look for `"postgres_up": true`, a `time` within the last two minutes, a
`last_archive_time` within the last minute or two, a `last_full_time` within
26 hours, `mem_available_mb` well above 100, and `"boot_mode"`:
`existing` after an ordinary boot, `restore` after a restore, `bootstrap` after
the first boot, `failed` or `refused` when something is wrong (then read
`journalctl -b -u brain-boot` on the host). The thirteen keys are all there is;
none holds user data.

## Getting a shell

The instance id changes every time the host is replaced (a host-file change, a
resize, a disk recovery), so find it by its name every time, never from a note
or an old terminal:

```sh
IID=$(aws ec2 describe-instances \
  --filters Name=tag:Name,Values=logjam-brain Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].InstanceId' --output text)
echo "$IID"
```

It must print exactly one id starting `i-`. (Run on a scratch copy.) Nothing
printed means the host is stopped or being replaced; two ids means a
replacement is in flight, so wait.

For one command and its output (run on a scratch copy; this is how every command
below that says "on the host" can be run):

```sh
brain() {  # brain '<command>': run it on the host as root and print the output
  local id
  id=$(aws ssm send-command --instance-ids "$IID" --document-name AWS-RunShellScript \
    --parameters "$(python3 -c 'import json,sys; print(json.dumps({"commands": [sys.argv[1]]}))' "$1")" \
    --query Command.CommandId --output text) || return
  aws ssm wait command-executed --command-id "$id" --instance-id "$IID" 2> /dev/null
  aws ssm get-command-invocation --command-id "$id" --instance-id "$IID" \
    --query '[Status, StandardOutputContent, StandardErrorContent]' --output text
}
brain 'docker ps --format "{{.Names}} {{.Status}}"'
```

Look for `brain-postgres-1 Up ... (healthy)` and, once serving, `brain-api-1 Up
... (healthy)`. For an interactive shell (needs the Session Manager plugin for
the AWS CLI; **not yet run anywhere**):

```sh
aws ssm start-session --target "$IID"
sudo -i
```

Limits, all met on the scratch copy:

- Each call is 4 to 12 seconds, so anything you need to sample over time needs
  a loop on the host, not a loop of calls.
- Output is cut at 24,000 characters. Pipe through `tail` or `grep`.
- The shell has no state between calls: `cd` does not carry. Write each command
  to stand alone, and use full paths.
- A new instance shows as `Online` about 30 seconds after it launches, before
  its first-boot script has finished: a command sent then sees a half-installed
  host. Wait for `brain 'cloud-init status'` to say `done`.
- If the host fails before the Session Manager agent starts there is no shell:
  read the console with `aws ec2 get-console-output --instance-id "$IID" --latest --output text`.
- AWS keeps a command's text and output for 30 days, and records only that a
  command was sent and by whom, not what it said.

## Bringing it up from nothing

Do these in this order; each step says why. Nothing here changes what users see:
the brain serves nobody until the cutover.

1. **Land the stack in its merge order**, the order the pull requests' bodies
   state. Two constraints matter. The backup, signals and role resources (the
   first brain Terraform change) must be applied before the change that makes
   `deploy-api.yml` write `release.json`: that workflow step writes into the
   signals bucket, so until the bucket exists every deploy fails at it. And
   merging the stack changes nothing running: with the settings dormant the plan
   adds only dormant resources (nothing is created until step 3).
2. **Apply the audit-trail change by hand, before any real data reaches the
   brain.** It changes the apply role's boundary, so `terraform-apply.yml`
   refuses it ([infra/AGENTS.md](../../infra/AGENTS.md)). It is what makes
   every read of a backup, and every shell on the host, a recorded event
   ([the policy](../DATA-ACCESS-POLICY.md) is untrue without it). From a
   checkout of `main`, with the maintainer's credentials (**not yet run
   anywhere**):

   ```sh
   cd infra/terraform/envs/prod
   (cd ../../../lambda/cognito-email-sender && npm ci && npm run build)
   (cd ../../../lambda/cognito-pre-signup && npm ci && npm run build)
   terraform init
   terraform plan -out=/tmp/audit.plan
   ```

   Read the plan. It must change the audit trail's selectors and the four
   policies that carry the privacy Deny (`gha_plan_readonly_privacy_deny`,
   `gha_readonly_privacy_deny`, the contributor group's policy, the apply
   boundary), and nothing else; stop if it shows anything else. Then
   `terraform apply /tmp/audit.plan`. A change to what the trail records takes
   about three minutes to take effect (measured), so wait that long before the
   next step.
3. **Publish the Postgres image and note its tag.** Merging a change under
   `infra/brain/postgres/` publishes it (`publish-brain-postgres.yml`); to
   publish what is on `main` now: `gh workflow run publish-brain-postgres.yml --ref main`.
   The tag is the commit's sha, and tags cannot be overwritten, so Terraform
   pins one. Find the newest (not yet run anywhere):

   ```sh
   aws ecr describe-images --repository-name logjam-brain-postgres \
     --query 'sort_by(imageDetails,&imagePushedAt)[-1].[imageTags[0],imagePushedAt]' --output text
   ```

   It must be a commit that contains every change to `infra/brain/postgres/`
   you want the brain to run: a rewind, for one, needs an image from after the
   point-in-time change.
4. **The settings pull request: create the brain.** In
   `infra/terraform/envs/prod/brain.auto.tfvars` set `brain_pg_image_tag` to the
   tag and `brain_bootstrap = true`, and nothing else (the instance type is
   already `t4g.micro`). The bootstrap flag is permission for the one boot that
   creates an empty database; without a backup in the repository, no flag
   means the boot refuses. Merge it; the plan comment shows the instance, the
   data volume, the Elastic IP and the alarms being added, and the apply takes
   about a minute. Then watch (all run on a scratch copy):
   - about 80 seconds for the host's first-boot script, then 12 seconds for the
     bootstrap itself (disk, database, roles, the first full backup);
   - `brain 'cat /run/brain/boot-mode'` ends `bootstrap`;
   - `brain 'docker ps --format "{{.Names}} {{.Status}}"'` shows
     `brain-postgres-1` healthy;
   - the status file (above) appears within a minute and names `bootstrap`;
   - a new object lands in the backup bucket about every 60 seconds:
     `aws s3 ls s3://logjam-brain-backups-620853681701/logjam/archive/logjam/ --recursive | tail -3`.

   If the boot ends `failed` or `refused`, read `brain 'journalctl -b -u brain-boot --no-pager | tail -40'`
   and fix the cause. Do not set `brain_bootstrap` to silence a refusal: it
   refuses precisely when a backup exists or the repository cannot be read.
5. **Turn the bootstrap flag off again**: a second pull request setting
   `brain_bootstrap = false`. It is an in-place tag change (2 seconds,
   measured), not a replacement. A blank disk with a backup restores whatever
   this says, but a brain that can bootstrap is a brain that may one day make
   an empty database where it should have refused.
6. **Start the restore drill once by hand**, so the first verdict exists
   without waiting for 04:30 and the watchdog's `drill_missing` clears (not yet
   run anywhere as written; the task and its settings were exercised on a scratch
   copy):

   ```sh
   SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=logjam-brain-drill-sg \
     --query 'SecurityGroups[0].GroupId' --output text)
   TASK=$(aws ecs run-task --cluster logjam-cluster --launch-type FARGATE --count 1 \
     --task-definition logjam-brain-drill \
     --network-configuration "awsvpcConfiguration={subnets=[subnet-0f59b0845905891be,subnet-0c10e1438a8fd0231],securityGroups=[$SG],assignPublicIp=ENABLED}" \
     --query 'tasks[0].taskArn' --output text)
   aws ecs wait tasks-stopped --cluster logjam-cluster --tasks "$TASK"
   aws ecs describe-tasks --cluster logjam-cluster --tasks "$TASK" \
     --query 'tasks[0].containers[0].[exitCode,reason]' --output text
   aws s3 cp s3://logjam-brain-signals-620853681701/drill.json -
   ```

   Look for exit code `0` and `"ok": true`, a `backup_label`, `restore_seconds`
   (8 seconds for a 28 MB database, 33 for 1.7 GB, measured), and no
   `error`. Anything else is a backup that does not restore: stop and read
   `/logjam/brain/drill` before going further.
7. **Fetch the certificate and finish its pull request.** The brain's
   certificate is made at first boot and cannot exist before. The images that
   run against the brain have to carry its public half, at `/app/brain-ca.pem`,
   or with serving on a task fails at start (never silently unverified). A draft
   pull request already carries the image changes; it is red until the file is
   in it. Fetch the file from the host (run on a scratch copy):

   ```sh
   CID=$(aws ssm send-command --instance-ids "$IID" --document-name AWS-RunShellScript \
     --parameters 'commands=["cat /data/postgres/server.crt"]' --query Command.CommandId --output text)
   aws ssm wait command-executed --command-id "$CID" --instance-id "$IID"
   aws ssm get-command-invocation --command-id "$CID" --instance-id "$IID" \
     --query StandardOutputContent --output text > infra/brain/brain-ca.pem
   openssl x509 -in infra/brain/brain-ca.pem -noout -subject -enddate -ext subjectAltName
   ```

   Look for a subject and one `DNS:` name equal to `ec2-…ap-southeast-2.compute.amazonaws.com`
   (`terraform output brain_public_dns` in `envs/prod` prints the same name), plus
   `postgres` and `localhost`, and an end date ten years out. The file is
   public, so it is safe to commit. The rehearsal copy (step 9) then proves it is
   the brain's: a wrong file fails verification and the copy refuses. Commit it to
   the draft branch, take it out of draft, merge. That deploys the API image and,
   because the change touches `topo/`, the topo worker image: check both
   deploys went green, and that the images carry it (not yet run anywhere):

   ```sh
   REGISTRY=$(aws sts get-caller-identity --query Account --output text).dkr.ecr.ap-southeast-2.amazonaws.com
   aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
   for r in logjam-api logjam-topo-worker; do
     docker run --rm --platform linux/amd64 --entrypoint ls "$REGISTRY/$r:latest" /app/brain-ca.pem
   done
   ```

   Each prints `/app/brain-ca.pem`. The file is not part of the host files, so
   committing it does not replace the instance.
8. **Check `release.json` exists.** The release agent refuses to start the API
   when serving is on and it cannot read it, and CI cannot read the bucket, so
   only you can look (run on a scratch copy):
   `aws s3 ls s3://logjam-brain-signals-620853681701/release.json`. The deploy of
   step 7 writes it.
9. **Rehearse the copy** against the brain while it is not serving, as
   [brain-cutover.md](brain-cutover.md#before-the-window) says. It is the first
   time real data reaches the brain, which is why step 2 comes first.
10. **Check the watchdog is green.** Its log group's latest line is
    `{"failed": []}`. The first day can show `drill_missing` (cleared by step 6)
    and, in the first minutes, `status_missing`, `full_stale` and `wal_stale`.

## A release and a rollback

Merging to `main` deploys. With `brain_serving` on, the deploy pins the task
definitions, migrates the brain's database, writes `release.json`, and waits up
to 5 minutes for the public `/meta` to name the new sha; the brain's timer
(every 30 seconds) then pulls the image and recreates the API container: under
load that is a few seconds of failed requests (3.2 s in one run and 13.2 s in
another, where the new layer was pulled inside the swap; the host now pulls
before it swaps, which has not been re-measured). A rollback rewrites the pointer
to the older sha. Both are [rollback.md](rollback.md)'s workflow and by-hand
steps, including what to check on the host when the brain does not follow
(`journalctl -u brain-release` and the status file's `api_sha`). A rollback only
works to a release built after the certificate was bundled.

## Changing a host file, and resizing

The host's scripts, Compose file and units travel inside the instance's user
data. Any change under `infra/brain/` (apart from `postgres/`, `tests/`,
`api.env` and the committed certificate), or to the settings written into
`/etc/brain/brain.env`, **replaces the instance**: about 3 minutes with the API
and database down, the data disk kept and reattached. The plan comment shows it
as a changed `brain_user_data_sha256`. Measured on a scratch copy: 31 s to stop
and detach, 46 s of Terraform, then the new host's boot, `/ready` 92 s after
the apply finished. Do it in a quiet hour, announce it if users could notice,
and do not merge anything else to `main` while it runs.

The user data is 13,839 bytes gzipped of EC2's 16,384-byte limit, and a guard
(`brain_user_data_stays_within_the_ec2_limit`) fails at 15,000. When a change
would cross it, move the host files into the brain's Postgres image instead,
which already carries the Compose plugin: the host would then fetch them from
the image it already pulls, and the limit stops mattering.

Resizing is one line, `brain_instance_type` in `brain.auto.tfvars` (`t4g.micro`,
`t4g.small`, `t4g.medium`, `t4g.large`: each sets Postgres's and the API's memory
limits from a table in `brain_instance.tf`). It also replaces the instance:
`/ready` came back 91 seconds after the apply for micro to small and 107 for
small to micro (about two minutes down; run on a scratch copy). The data disk is
untouched. The small costs US$7.74 a month more than the micro.

## A Postgres container someone stopped by hand

`docker stop` and `docker kill` count as "the operator meant it", so Docker does
not restart the container and nothing else starts Postgres until the next boot.
The API stays unhealthy and every request fails. On the host (run on a scratch
copy; 5.8 seconds to a healthy Postgres):

```sh
brain 'systemctl restart brain-boot && docker ps --format "{{.Names}} {{.Status}}"'
```

Look for `brain-postgres-1 Up ... (healthy)`; the API recovers by itself. A real
crash is different: Docker restarts it in about a second.

## Losing the disk or the zone

The data disk is a separate volume that Terraform will not destroy. Losing it
(or its zone) is one pull request, applied like any other, that adds the next
volume and makes it current; the new host finds a blank disk, restores the
newest backup into it, and starts. In `brain.auto.tfvars` (not yet run on prod;
the same change ran on a scratch copy):

```hcl
brain_data_volumes = {
  "1" = { az = "ap-southeast-2a", size_gb = 20 }
  "2" = { az = "ap-southeast-2a", size_gb = 20 } # "ap-southeast-2b" if the zone is lost
}
brain_data_volume_current = "2"
```

Use the next unused key, never edit a volume that has booted, and leave the old
entry. Merge it and watch the plan: it must replace `aws_instance.brain` and
create `aws_ebs_volume.brain_data["2"]`. Measured on a scratch copy, one apply:
the API answered 109 seconds after it for a 28 MB database and 183 seconds for a
1.7 GB one (the restore itself about 30 seconds, then a new full backup of
66 seconds before the API starts). Nothing is lost beyond about a minute of
writes: no acknowledged row was lost in four of five runs; the fifth, where the
backup bucket was unreachable as the old host shut down, lost 42 seconds.

Check afterwards: `brain 'cat /run/brain/boot-mode'` says `restore`; the status
file's `last_restore_at` is now and `postgres_up` is true; the watchdog goes
green once a new WAL object and the post-restore full backup exist. **Read
`last_restore_lag_seconds` after any restore.** It is the age of the newest
restored data when recovery ended, so it is the outage plus the loss: subtract
how long the host was down to get the loss. 242 seconds after a four-minute
outage was a loss of well under a minute. Nothing alarms on it, because every
real recovery is over any threshold you could pick.

A failed restore (boot mode `failed`) leaves the new volume half made. Do not
retry on it: add a further key, `"3"`, and make that current.

## Rewinding to a point in time, and undoing it

For bad data (a migration that mangled rows, a mass delete) that backups already
contain, rewind to just before it: the same change as losing the disk, with one
field on the new entry. Postgres restores to that time instead of the latest
state. It needs the image from the point-in-time change (step 3 of bring-up). In
`brain.auto.tfvars` (the same change ran on a scratch copy; not yet run on prod):

```hcl
brain_data_volumes = {
  "1" = { az = "ap-southeast-2a", size_gb = 20 }
  "2" = { az = "ap-southeast-2a", size_gb = 20, restore_to = "2026-11-20T03:15:00+11:00" }
}
brain_data_volume_current = "2"
```

The time is a real time with a UTC offset (`Z` for UTC is fine); one without an
offset is refused. Leave `restore_to` on its entry afterwards: removing it only
replaces the host for nothing, and it can never apply to a later volume because
a boot restores into a blank disk only.

**Picking the time.** Choose a moment just before the first bad statement.
On the host (run on a scratch copy):

- The backups and the window you can reach:
  `brain 'docker exec -u postgres brain-postgres-1 pgbackrest --stanza=logjam info'`
  lists each backup with its start and stop times and the archive's WAL range.
  The target must be after the oldest backup's stop and not after the newest
  WAL. Fulls are nightly at 03:00 Sydney time and eight are kept.
- When it happened: the Postgres log group (`/logjam/brain/postgres`) has pgaudit
  lines in UTC for every write and DDL statement, with no values; a `DELETE` or a
  migration's statements show the time. The API log (`/logjam/brain/api`) shows
  request times and the deploy. Convert UTC to the offset you write.

**Confirming it worked.** `brain 'cat /run/brain/boot-mode'` says `restore`;
`brain 'cat /data/brain/last-restore'` shows when, how stale the data was at the
target (seconds, if archiving was healthy), and the target; `brain 'journalctl -u brain-boot --no-pager | grep "restoring to"'`
shows the time; `brain 'docker exec brain-postgres-1 psql -U postgres -d logjam -c "select pg_is_in_recovery()"'`
says `f`; the Postgres log has `starting point-in-time recovery to <time>`,
`selected new timeline ID`, `archive recovery complete`. For a rewind
`last_restore_lag_seconds` is measured from the target, not from now: it is how
stale the data was at T, not the days since. A look at the damaged table's row
count is your call. A target the archive cannot reach (after the newest WAL, or
before the oldest backup) ends boot mode `failed` with nothing serving, never a
database promoted somewhere else; add a new key with a corrected time.

**What happens to what was written between T and the rewind.** It stays on the
old volume, detached and untouched, and in the archive's old timeline. It is
not in the new database.

**Undoing it, or rewinding again.** A restore follows the newest backup, and the
newest backup is always of the live database. So a second rewind, earlier or
later, is the same change with the next key. And putting the old volume back is
safe: set `brain_data_volume_current` to the old key. It boots as it was, notices
the newest backup is on another timeline, takes a full backup of itself (the API
waits for it, a minute or so on a small database), and later restores follow it.
Either way the data written on the volume you leave is not on the one you take.
The rewind, a second rewind and a re-attach were all exercised on a scratch copy.

## Deleting an old volume

A volume left by a recovery or a rewind holds a full copy of the database until
it is deleted ([the policy](../DATA-ACCESS-POLICY.md), limit 7), and costs a
little. Delete it only when it is no longer the undo: after you are sure of the
new database, and not before the next nightly full has run on it. It is a pull
request that removes its entry from `brain_data_volumes` and adds a `removed`
block for it; the plan must show exactly that one volume destroyed and nothing
else. **Not yet run anywhere**, and deletion is final: the volume's data cannot
be recovered (the backups are what remain).

## The cost ceiling and the sign-up cap

- **Cost ceiling:** at US$100 of spend in a month AWS Budgets attaches a deny to
  the API's roles (new worker jobs and uploads fail); read what it does and how
  to undo it in [alarms.md](alarms.md#cost-ceiling).
- **Sign-up cap:** new accounts stop for the month when sign-ups reach the
  monthly cap; read how to see the count or raise it in
  [alarms.md](alarms.md#sign-up-cap).

## When it outgrows the box

Two signals tell you, and neither is automatic: the brain does not resize or
scale itself.

- **CPU: `logjam-brain-cpu-high`**, one hour averaging 20 % or more of the
  instance. That is about the load of 20 requests a second; above the free
  allowance it costs cents, and it needs no action by itself. **50 % is about
  60 requests a second, three quarters of the way to the limit.** On a scratch
  copy 20, 40, 60 and 80 requests a second used 21, 36, 50 and 64 % of the
  instance.
- **Memory: the `memory_low` check** (under 100 MB free). On a `t4g.micro` the
  lowest seen was 164 MiB (a release swap with a 1.7 GB database) and 331 idle.

**What the limit is.** The API is one Node process, which uses one core. On both
sizes tested 80 requests a second passed (p95 269 ms on the micro, 313 ms on the
small) and 100 failed, on CPU. So a bigger `t4g` adds memory, not speed. Prod
averages about 0.004 a second; the limit is where growth would end, not a
number to approach soon.

**The ladder**, in order; stop at the first step that helps:

1. **Memory alarm: one size up.** One line, `brain_instance_type`, about two
   minutes down (see above).
2. **CPU alarm: find out whether it is growth or one client misbehaving.** Look
   at the API log by client and path. The per-user rate limits
   (`api/src/middleware/rateLimit.ts`) and the web firewall's per-address rule
   (`infra/terraform/envs/prod/waf.tf`) are the first tools; use them before
   adding capacity.
3. **Real growth past one core: run the API as more than one process on a type
   with more cores.** Not built. Of the two changes it needs first, one is done:
   the background sweeps run in one process per database, held by a Postgres
   advisory lock. The other is not: the rate limiter keeps its counters in each
   process's memory (`api/src/middleware/rateLimit.ts`), so several processes
   would each allow the full rate and the per-user limits would stop meaning
   anything; they must be shared first.
4. **Past one host: the API moves to its own instances behind a load balancer**
   and keeps talking to the brain's Postgres by name, as the workers already do
   (the brain's security group would need a rule for them). Not built.

Steps 3 and 4 are not built; the first two are the whole plan until the alarms
say otherwise.
