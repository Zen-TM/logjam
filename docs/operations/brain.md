# The brain: running it

The brain is Logjam's API and its Postgres on one EC2 instance. It replaced
Elastic Beanstalk and RDS, which are gone ([what to delete by hand](#the-retired-stack-what-to-delete-by-hand)).
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
- **Its settings** are in `infra/terraform/envs/prod/brain.auto.tfvars`,
  changed one line at a time by a merge: the image tag, the data volumes, the
  instance size, `brain_serving` (whether its API runs) and the one-time
  `brain_bootstrap`.
- **An outside check** (a Lambda every 5 minutes) and a few CloudWatch alarms
  email the maintainer; [alarms.md](alarms.md) says what each one means.

Every command below is complete and says what to look for, and runs from the
repository root. Each is marked **run on a scratch copy** (a rehearsal on a
throwaway copy of the brain on real AWS: 2026-11-10, and again on the finished
stack on 2026-11-11; timings are quoted as measured there, with made-up rows)
or **not yet run anywhere**. Prod's numbers will differ with the size of the
database. Use the maintainer's AWS credentials and
`export AWS_REGION=ap-southeast-2`.

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
none holds user data. During a boot the first status report can say
`"boot_mode": "failed"` for about a minute: the boot script writes `failed`
first and overwrites it once it knows the mode (seen 2026-11-11). Do not chase
it unless the next report still says it; the watchdog's alarm needs two failing
runs out of three.

Run the outside check now, rather than waiting for its 5 minutes (run on a
scratch copy; decode the log with `base64 -d`):

```sh
aws lambda invoke --function-name logjam-brain-watchdog --payload '{}' \
  --cli-binary-format raw-in-base64-out --log-type Tail --query LogResult --output text /dev/null | base64 -d
```

Green is `{"failed": []}`. A failure prints codes ([alarms.md](alarms.md#logjam-brain-checks-failing)
says what each means). On the scratch copy `status_stale`, `wal_stale` and
`api_unready` each fired alone, and the 5-minute schedule fired by itself.

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

## Rebuilding it when there is none

When the instance and its data disk are both gone, the data comes back from
the backups bucket, never from a copy: nothing else holds it. The bucket is
versioned and Object Lock keeps every version for 7 days, so a deleted host
does not take it with it. Restoring into a blank disk ran on a scratch copy
([Losing the disk or the zone](#losing-the-disk-or-the-zone) has the timings);
this whole sequence is **not yet run anywhere**. Do these in this order; each
step says why.

1. **Check the foundations are still there.** Terraform made the buckets,
   roles, log groups and the audit trail (`terraform-apply.yml`), and the
   apply role's boundary was applied by hand once (`DenySnapshotBlocks`,
   `DenyShells` and `DenyCommandOutput`, kept out of CI's reach because
   `terraform-apply.yml` refuses a plan that edits that boundary;
   [infra/AGENTS.md](../../infra/AGENTS.md)). A plan of `main` must show the
   brain and nothing else to create: stop if it shows the bucket, the roles or
   the boundary. Read it, from a checkout of `main`, from the repository root,
   with the maintainer's credentials (run on a scratch copy):

   ```sh
   for l in cognito-email-sender cognito-pre-signup; do
     npm --prefix infra/lambda/$l ci && npm --prefix infra/lambda/$l run build
   done
   terraform -chdir=infra/terraform/envs/prod init
   terraform -chdir=infra/terraform/envs/prod plan -out=/tmp/rebuild.plan
   ```
2. **Pick the Postgres image tag.** `brain_pg_image_tag` in `brain.auto.tfvars`
   already names one; tags cannot be overwritten, so it still exists unless
   someone deleted it. To publish what is on `main` now:
   `gh workflow run publish-brain-postgres.yml --ref main`. The newest tag
   (not yet run anywhere):

   ```sh
   aws ecr describe-images --repository-name logjam-brain-postgres \
     --query 'sort_by(imageDetails,&imagePushedAt)[-1].[imageTags[0],imagePushedAt]' --output text
   ```

   It must be a commit that contains every change to `infra/brain/postgres/`
   the brain needs: a rewind, for one, needs an image from after the
   point-in-time change.
3. **Create the host: one pull request.** A deleted instance comes back with
   any apply while the tag is set; a deleted data volume needs the next key in
   `brain_data_volumes`, made current, as in [Losing the disk or the
   zone](#losing-the-disk-or-the-zone). **Leave `brain_bootstrap` false.** It is
   permission to make an empty database where no backup exists, which a rebuild
   is not: with a backup in the repository a blank disk restores whatever it
   says, and without one the boot refuses, which is the right answer to a
   repository that cannot be read. Merge it; the plan comment shows the
   instance, the volume and the alarms being added, and the apply takes about
   a minute. Then watch (all run on a scratch copy, 2026-11-11):
   - about 75 seconds for the host's first-boot script, then the restore
     (about 30 seconds for a 1.7 GB database, then a new full backup of about a
     minute before the API starts);
   - `brain 'cat /run/brain/boot-mode'` ends `restore`;
   - `brain 'docker ps --format "{{.Names}} {{.Status}}"'` shows
     `brain-postgres-1` healthy;
   - the status file (above) appears within a minute and names `restore`, with
     `last_restore_lag_seconds`, the outage plus the loss;
   - a new object lands in the backup bucket about every 60 seconds:
     `aws s3 ls s3://logjam-brain-backups-620853681701/logjam/archive/logjam/ --recursive | tail -3`.

   If the boot ends `failed` or `refused`, read `brain 'journalctl -b -u brain-boot --no-pager | tail -40'`
   and fix the cause. A failed restore leaves the new volume half made: add a
   further key and make that current rather than retry on it.
4. **Start the restore drill once by hand**, so a verdict exists without
   waiting for 04:30 and the watchdog's `drill_missing` clears (run on a
   scratch copy, with scratch names):

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
   (33 for 1.7 GB; the whole task about 30 seconds, 21 of them pulling the
   image), `tables_read` (the number of tables) and no `error`. Anything else
   is a backup that does not restore: stop and read `/logjam/brain/drill`.
5. **Check the certificate is the one the images carry.** The restore brings
   the same certificate back inside the backup, so the committed public half
   (`brain-ca.pem` in `infra/brain/` and `topo/`) still fits. It does not fit
   if the Elastic IP changed (its DNS name is in the certificate): then the
   API and the workers fail at start, never silently unverified. Compare the
   host's with the committed one (run on a scratch copy):

   ```sh
   CID=$(aws ssm send-command --instance-ids "$IID" --document-name AWS-RunShellScript \
     --parameters 'commands=["cat /data/postgres/server.crt"]' --query Command.CommandId --output text)
   aws ssm wait command-executed --command-id "$CID" --instance-id "$IID"
   aws ssm get-command-invocation --command-id "$CID" --instance-id "$IID" \
     --query StandardOutputContent --output text | cmp - infra/brain/brain-ca.pem && echo same
   openssl x509 -in infra/brain/brain-ca.pem -noout -subject -enddate -ext subjectAltName
   ```

   `same`, and a `DNS:` name equal to `terraform -chdir=infra/terraform/envs/prod output brain_public_dns`.
   If it differs, commit the host's file as both copies and merge, which
   deploys the API image and the topo worker image
   ([0048](../decisions/0048-database-connections-verify-the-brains-certificate-and-never-fall-back-to-plain.md)).
   The file is not part of the host files, so committing it does not replace
   the instance.
6. **Check `release.json` names the live release.** The release agent refuses
   to start the API when serving is on and it cannot read the file, and it runs
   whatever commit the file names. CI cannot read the bucket, so only you can
   look (the read ran on a scratch copy; the comparison is **not yet run
   anywhere**):

   ```sh
   aws s3 cp s3://logjam-brain-signals-620853681701/release.json - | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])'
   curl -s https://api.logjamnsw.com/meta | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])'
   ```

   The two lines must be the same commit (the second answers once the API is
   up). They differ after a deploy that was rolled back: a rollback to a
   release from before the brain cannot rewrite the file, which then still
   names the release that failed. Deploy once more (merge anything, or run
   `deploy-api.yml` on `main`) and look again.
7. **Turn serving on only once the data is checked.** `brain_serving` stays
   `false` until the restore's `last_restore_lag_seconds` and the drill say the
   data is the data you expect: the API's background sweeps delete media that
   has no row in *their own* database, and the media bucket has no versioning
   to get a photo back. Then set `brain_serving = true` in a pull request.
8. **Check the watchdog is green.** Its log group's latest line is
   `{"failed": []}`. The first minutes can show `status_missing`, `full_stale`
   and `wal_stale`, and `logjam-brain-watchdog-not-running` may email once in
   its first fifteen minutes, before the check's first run has been counted,
   and clear by itself.

## A release and a rollback

Merging to `main` deploys. The deploy pins the task definitions, migrates the
brain's database, writes `release.json`, and (with `brain_serving` on) waits up
to 5 minutes for the public `/meta` to name the new sha; the brain's timer
(every 30 seconds) then pulls the image and recreates the API container. Measured
on the finished stack at 40 requests a second (2026-11-11): the host pulls first,
so the pull is not in the gap; with the API as it was, 462 requests failed over
13.1 seconds, because the old API kept waiting for open connections until Docker
killed it after its 10-second stop timeout; with the shutdown fix (#875) the same
swap failed 151 requests over 3.8 seconds, and idle it takes under a second.
Expect about 4 seconds under load once #875 is merged. A rollback rewrites the pointer
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
as a changed `brain_user_data_sha256`. Measured on a scratch copy (2026-11-11),
one apply with no help: 81 s of Terraform (31 s of it stopping and detaching),
then the new host's boot; 165 s down in all, `/ready` 90 s after the apply
finished, same certificate, every marker row present. Do it in a quiet hour,
announce it if users could notice, and do not merge anything else to `main`
while it runs.

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
create `aws_ebs_volume.brain_data["2"]`. Measured on a scratch copy, one apply
(2026-11-11): the plan named the replacement, the apply took 105 seconds, and
`/ready` answered 196 seconds after the apply began (97 after it ended) for a
27 MB database; on the first rehearsal 109 seconds after the apply for 28 MB and
183 for a 1.7 GB one (the restore itself about 30 seconds, then a new full backup
of 66 seconds before the API starts). Nothing is lost beyond about a minute of
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
`brain.auto.tfvars` (the same change ran on a scratch copy on 2026-11-11, one apply
and about 3 minutes to `/ready` each time; not yet run on prod):

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
The rewind, a second rewind to a later time, putting a volume back, and then a
disk loss were all exercised on a scratch copy in one run (2026-11-11), every step
one apply, with the rows exactly as this says: a rewind keeps every row at or
before the target and none after it, and a later disk loss restores the volume
that was live.

## Deleting an old volume

A volume left by a recovery or a rewind holds a full copy of the database until
it is deleted ([the policy](../DATA-ACCESS-POLICY.md), limit 7), and costs a
little. Delete it only when it is no longer the undo: after you are sure of the
new database, and not before the next nightly full has run on it. Deleting it is
final: its data cannot be recovered (the backups are what remain).

Terraform will not do it from a pull request alone: the volume has
`prevent_destroy` (removing its entry is refused), and a `removed` block cannot
name one instance of a resource. So it is done by hand, from the maintainer's
own machine, in this order. The volume must be detached: it is not the current
one (`brain_data_volume_current`). Run on a scratch copy (2026-11-11), where
`prevent_destroy` is off; the refusal itself was checked with a stand-in
resource. `<key>` is the entry's key, such as `1`:

```sh
terraform -chdir=infra/terraform/envs/prod state show 'aws_ebs_volume.brain_data["<key>"]' | grep -E '^ +id '
terraform -chdir=infra/terraform/envs/prod state rm 'aws_ebs_volume.brain_data["<key>"]'
aws ec2 delete-volume --volume-id <the id state show printed>
```

Read the id **before** `state rm` (it is also in the volume's `Name` tag,
`logjam-brain-data-<key>`). Check `aws ec2 describe-volumes --volume-ids <id>`
says `available` first, never `in-use`. Then merge a pull request that removes
the entry from `brain_data_volumes` in `brain.auto.tfvars`. Until it merges the
entry is still wanted, and a plan would create a new, empty volume for it; once
it is gone the plan says "No changes": the instance is not replaced and the user
data does not change.

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
  lowest seen idle was 324 MiB (2026-11-11, with the timers as they are now; the
  whole host used 0.066 of two vCPUs) and 164 MiB under a release swap with a
  1.7 GB database (2026-11-10).

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

## The retired stack: what to delete by hand

Elastic Beanstalk and RDS were removed by Terraform (the teardown's two pull
requests). What Terraform never owned is left, and one set of leftovers holds
user data, so it goes first. The maintainer's credentials; every command here
is **not yet run anywhere**. The reads were run on 2026-11-11 (before the
removal) and showed the first two lists below not empty.

1. **Snapshots and backups of the old database.** `skip_final_snapshot` and
   `delete_automated_backups` mean the instance's own go with it; a manual
   snapshot does not. List them, delete the cutover snapshot
   (`logjam-cutover-final`) and any other the lists show (on 2026-11-11 there
   was also `logjam-db-final-2026-06-23-enc`, from the encryption migration),
   then list again until both are empty:

   ```sh
   aws rds describe-db-snapshots --snapshot-type manual \
     --query 'DBSnapshots[].[DBSnapshotIdentifier,DBInstanceIdentifier]' --output text
   aws rds describe-db-instance-automated-backups \
     --query 'DBInstanceAutomatedBackups[].[DBInstanceIdentifier,Status]' --output text
   aws rds delete-db-snapshot --db-snapshot-identifier logjam-cutover-final
   ```

   Both lists must print nothing. A snapshot copied to another region or
   shared with another account is listed there, not here: check
   `aws rds describe-db-snapshot-attributes --db-snapshot-identifier <id>` for
   a snapshot you delete.
2. **The Elastic Beanstalk log groups** keep the old API's request log (IPs
   and paths) until their retention ends (14 days; the health log 7), because
   the environment was set not to delete them. To drop them now, list
   (`aws logs describe-log-groups --log-group-name-prefix /aws/elasticbeanstalk`)
   and `aws logs delete-log-group --log-group-name <name>` each.
3. **IAM, before the apply of the second pull request:** detach the RDS
   master-secret policy from the old instance role, because IAM refuses to
   delete a policy that is attached, and Terraform deletes that policy:

   ```sh
   aws iam detach-role-policy --role-name logjam-eb-role \
     --policy-arn arn:aws:iam::620853681701:policy/DatabasePasswordAccess
   ```

   After the apply, the old role has nothing of Terraform's left on it. Remove
   what it was made with: its inline policies (`logjam-api-ecs-runtask`, which
   was never in Terraform), its managed attachments
   (`aws iam list-attached-role-policies --role-name logjam-eb-role`), then the
   instance profile and the role, and the Elastic Beanstalk service role
   `logjam-eb-service-role`:

   ```sh
   aws iam remove-role-from-instance-profile --instance-profile-name logjam-eb-role --role-name logjam-eb-role
   aws iam delete-instance-profile --instance-profile-name logjam-eb-role
   # detach each managed policy listed, delete each inline one, then:
   aws iam delete-role --role-name logjam-eb-role
   ```
4. **The database subnet group and the old deploy bucket.** The subnet group
   `logjam-db-subnet-group` is free and unused once the instance is gone
   (`aws rds delete-db-subnet-group --db-subnet-group-name logjam-db-subnet-group`).
   The bucket `elasticbeanstalk-ap-southeast-2-620853681701` holds the old
   application versions and rotated logs, and is empty-then-delete by hand when
   nothing needs them. The CI privacy Deny still names it, so deleting it does
   not widen anything.
5. **The two repository secrets** `EB_APPLICATION_NAME` and
   `EB_ENVIRONMENT_NAME`: no workflow reads them. Delete them in the
   repository's settings (`gh secret delete <name>`).
