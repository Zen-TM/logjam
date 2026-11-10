# The cutover: moving prod from RDS and Elastic Beanstalk to the brain

The window in which users' data and traffic move to the brain
([brain.md](brain.md) says what it is and how it is brought up;
[ADR 0047](../decisions/0047-prod-runs-on-one-self-managed-instance-with-object-lock-backups.md)
says why). It is the one irreversible, prod-touching operation in the move, so it
is done in an announced window, by the maintainer, as a short list of merges and
commands with a check after each.

**Status of this page.** Nothing here has been run against prod. The copy task,
the brain's boot, release, restore and rollback paths, and the timings quoted
as "measured" were exercised on a scratch copy of the brain on real AWS (2026-11-10,
and again on the finished stack on 2026-11-11, which also had a scratch RDS to
copy from), with made-up data. Each command says which: **run on a scratch
copy**, **estimate**, or **not yet run anywhere**. Use the maintainer's AWS
credentials and `export AWS_REGION=ap-southeast-2`. `brain '<command>'` is the
helper defined under "Getting a shell" in [brain.md](brain.md); `IID` is the
instance id found there.

> **Two rules, in a box.**
>
> 1. **Never turn serving on before the final copy.** The brain's API runs
>    background sweeps that delete media files with no row in *their own*
>    database. Serving on a database that is behind RDS would delete photos RDS
>    has confirmed, and the media bucket has no versioning to get them back.
> 2. **Elastic Beanstalk's sweeps must be off before serving goes on.** The old
>    API keeps sweeping against the now-frozen RDS otherwise, and its sweep would
>    delete every file confirmed on the brain, since RDS has no row for it.

## Before the window

Each of these is its own merge or check, done in the days before.

1. **The brain is up and healthy** ([brain.md](brain.md), "Bringing it up from
   nothing", all ten steps): the stack landed, the boundary change applied by
   hand, the Postgres image published and pinned, the brain created and its
   bootstrap flag turned off again, the drill started once by hand and
   passing, the certificate fetched and its pull request finished and deployed
   (**both** the API image and the topo worker image carry
   `/app/brain-ca.pem`), `release.json` naming the live release, the watchdog
   green.
2. **The audit trail and the boundary change are applied before real data
   reaches the brain.** Steps 1 and 2 of bring-up. The next step is the first
   time real data does.
3. **Rehearse the copy, at least once.** Against the brain while it is not
   serving, with the same task the window uses. The brain must be up and writing
   a fresh `status.json` (no file, or one older than 3 minutes, is a refusal),
   the serving tag must be `off`, the certificate must be committed and applied
   (an empty one is a refusal), and the task definition's image tag must be the
   one the brain runs. Look up the network once (run on a scratch copy):

   ```sh
   CLUSTER=logjam-cluster
   SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=logjam-worker-sg \
     --query 'SecurityGroups[0].GroupId' --output text)
   NET="awsvpcConfiguration={subnets=[subnet-0f59b0845905891be,subnet-0c10e1438a8fd0231],securityGroups=[$SG],assignPublicIp=ENABLED}"
   ```

   RDS is live until the window, and the copy stops on a source that is not
   read-only. The two rehearsal commands below therefore carry
   `COPY_ALLOW_LIVE_SOURCE=1`, which lets it copy from a live source: counts then
   may differ, and the last line says the source was live instead of
   `every check held`. The window's copy (step 4 below) is the same command
   **without** that entry, so a forgotten read-only step stops the copy. The flag
   itself has **not yet been run on AWS**; the copy's other behaviour is as marked.

   The first copy into an empty brain (the same command, before the flag existed,
   run on a scratch copy against a scratch RDS):

   ```sh
   TASK=$(aws ecs run-task --cluster $CLUSTER --launch-type FARGATE --count 1 \
     --task-definition logjam-brain-copy --network-configuration "$NET" \
     --overrides '{"containerOverrides":[{"name":"brain-copy","environment":[{"name":"COPY_ALLOW_LIVE_SOURCE","value":"1"}]}]}' \
     --query 'tasks[0].taskArn' --output text)
   aws logs tail /ecs/logjam-brain-copy --follow --since 5m
   aws ecs wait tasks-stopped --cluster $CLUSTER --tasks "$TASK"
   aws ecs describe-tasks --cluster $CLUSTER --tasks "$TASK" \
     --query 'tasks[0].containers[0].[exitCode,reason]' --output text
   ```

   (Stop the `logs tail` with Ctrl-C when the task has stopped.) The log has
   table names and counts only. Look for exit code `0` and a last line that
   starts `copy: ok` (`copy: ok: the source was live, ...` for these rehearsals).
   Anything else (`NOT VERIFIED: ...`,
   `RESTORED BUT NOT VERIFIED: do not serve from this copy`, exit 1) means do not
   serve: read the reason and re-run. This is also what proves the committed
   certificate is the brain's: a wrong file fails verification and the copy
   refuses. Take **a later rehearsal, or the real copy, over an earlier copy**
   with `COPY_REPLACE=1`; without it the copy refuses a brain that already holds
   tables:

   ```sh
   TASK=$(aws ecs run-task --cluster $CLUSTER --launch-type FARGATE --count 1 \
     --task-definition logjam-brain-copy --network-configuration "$NET" \
     --overrides '{"containerOverrides":[{"name":"brain-copy","environment":[{"name":"COPY_REPLACE","value":"1"},{"name":"COPY_ALLOW_LIVE_SOURCE","value":"1"}]}]}' \
     --query 'tasks[0].taskArn' --output text)
   ```

   Timing, **measured on a scratch copy (2026-11-11), made-up rows**: 1,764 MB in
   197 seconds (537 MB a minute; 18 of the seconds are pulling the task's image),
   three runs of the same size: dump 69 s, restore 38 s, counts verified 65 s
   (counting 6 million rows twice is a third of it). Prod's database is about
   1.7 GB, so plan about 4 minutes for it (derived from that rate). Also measured: a copy against a
   **serving** brain exits 1 at once (`copy: status.json does not say serving is
   false: stopping`) and touches nothing; with the source read-only and
   `COPY_REPLACE=1` the counts verify exactly (a deleted row and an edited title
   arrived), and the brain is **not** read-only afterwards. Watch the brain's
   memory (`mem_available_mb` in the status file) while it restores: a
   `t4g.micro` had 324 MiB free at its idle minimum. After a rehearsal the brain
   holds a copy of real data, so it is **not** empty when the window comes, which
   is why the window's copy always uses `COPY_REPLACE=1`.

   To rehearse **again from empty** you cannot use a fresh volume: a blank disk
   with a backup in the repository always restores, so it would restore the data
   back. Empty the schema instead (everything in the brain's database is lost, so
   never on a serving brain; run on a scratch copy, 2026-11-11). Dropping the
   schema also drops the pgaudit extension, which lives in it, hence the third
   statement:

   ```sh
   brain 'docker exec brain-postgres-1 psql -U postgres -d logjam -c "drop schema public cascade; create schema public authorization logjam_app; create extension pgaudit;"'
   ```

   On prod this only matters for a repeat from empty: the first copy lands in a
   brain that was bootstrapped empty.
4. **Compare what the dump does not carry.** Database-level settings do not
   travel in a dump. On RDS, as the master user (a recorded read; **not yet run
   anywhere**):

   ```sql
   select d.datname, r.rolname, s.setconfig from pg_db_role_setting s
     left join pg_database d on d.oid = s.setdatabase
     left join pg_roles r on r.oid = s.setrole;
   select extname from pg_extension order by 1;
   ```

   Anything beyond pgaudit and the application role's own pgaudit setting is a
   setting the brain does not have: decide whether it must, before the window.
   (This query was written for this runbook and has not been run anywhere.)
   (`default_transaction_read_only` shows only after step 3 of the window, and is
   the one setting the copy checks the brain does not inherit.)
5. **Check the images and the settings.** The API image and the topo worker image
   hold `/app/brain-ca.pem` at `:latest` and at the sha the topo task families
   carry (brain.md, step 7 of bring-up). `brain.auto.tfvars` has
   `brain_serving = false` and `brain_public = false`.
6. **Prepare the two pull requests**, each a one-line change to
   `brain.auto.tfvars`, ready to merge: `brain_serving = true`, and, on its own
   branch, `brain_public = true` (it is refused unless serving is on, which is
   right: do not flip both in one). Everything they need is already on `main`,
   reviewed and tested; each flip is one line and each rollback is its revert.
7. **Announce.** Say when, for how long (plan an hour), and what users see: in
   the window Logjam Web shows its usual error where it cannot save, and Logjam
   GPS keeps edits in its outbox and retries by itself.

## The window

Times are what was measured on a scratch copy where there is a number, and an
estimate otherwise. The whole list is **not yet run anywhere** on prod.

**`main` is frozen from step 1 to step 8**: every merge to `main` deploys the
API, and a deploy in the middle of the window does the wrong thing for the
step it lands in. For example, while RDS is read-only a deploy's migrate step
passes if no migration is pending (`prisma migrate deploy` exits 0, "No pending
migrations to apply") and the deploy goes on to swap Elastic Beanstalk; with a
migration pending it exits 1 at its first insert ("cannot execute INSERT in a
read-only transaction"), changes nothing, and the deploy stops before the swap
(measured against a scratch RDS, 2026-11-11). No merges (except the two flips
below), no hand workflow runs other than the one named in step 6a, no hand
`terraform apply`. Before each flip, check that nothing is running:
`gh run list --workflow deploy-api.yml --limit 3` and
`gh run list --workflow terraform-apply.yml --limit 3` show nothing in progress.

1. **Freeze `main` and record the topo image.** The topo task families will need
   re-pinning after the first flip; note what they carry now:

   ```sh
   TOPO_SHA=$(aws ecs describe-task-definition --task-definition logjam-topo-worker \
     --query 'taskDefinition.containerDefinitions[0].image' --output text | sed 's/.*://')
   echo "$TOPO_SHA"
   ```

   It must print a 40-character sha, not `latest`. If it says `latest`, find the
   sha before going on (the last `worker` deploy's run names it).
2. **Turn Elastic Beanstalk's sweeps off** (about 65 seconds; the API restarts,
   so it is down for that long; the environment's four last configuration
   changes took 65 to 67 seconds). Not yet run anywhere:

   ```sh
   aws elasticbeanstalk update-environment --environment-name logjam-api-prod \
     --option-settings Namespace=aws:elasticbeanstalk:application:environment,OptionName=TOPO_REAPER_INTERVAL_MS,Value=0
   ```

   Check: the option reads `0`, the environment is `Ready` and `Green`, and its
   log shows `topo_job_reaper_disabled`:

   ```sh
   aws elasticbeanstalk describe-configuration-settings --application-name logjam \
     --environment-name logjam-api-prod \
     --query "ConfigurationSettings[0].OptionSettings[?OptionName=='TOPO_REAPER_INTERVAL_MS'].Value" --output text
   aws elasticbeanstalk describe-environments --environment-names logjam-api-prod \
     --query 'Environments[0].[Status,Health]' --output text
   ```

3. **Let running topo jobs finish, then make RDS read-only.** There is no pause
   switch for topo jobs. Once RDS is read-only no new job or export can start (the
   request fails with a server error before any task launches: users see an
   error on starting a map or an export); a task already running cannot write its
   result, its row stays `processing`, and the brain's sweep fails it later with
   the usual "stopped because it took too long" message. A map can run for hours,
   so look first:

   ```sh
   aws ecs list-tasks --cluster logjam-cluster --desired-status RUNNING \
     --query 'taskArns' --output text
   ```

   Wait for any topo-worker or topo-export-worker task to end, or accept that it
   will fail. (Scheduled tasks such as the place registry touch no database.)
   Then, in a master-user `psql` session on RDS (a recorded read; not yet run
   anywhere as written; the same statements ran on a scratch RDS), make it
   read-only and end the other sessions:

   ```sql
   ALTER DATABASE logjam SET default_transaction_read_only = on;
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname = 'logjam' AND pid <> pg_backend_pid();
   ```

   Check: a write from the application now fails (Logjam Web's save shows its
   error); `show default_transaction_read_only` in a new session says `on`. (That
   session is itself read-only, which matters for undoing it: see "Rolling back".) Then
   take **the final snapshot**, the rollback copy (it holds real data and does not
   expire: the teardown deletes it, see the policy's limit 8; **not yet run
   anywhere**):

   ```sh
   aws rds create-db-snapshot --db-instance-identifier logjam-db-enc \
     --db-snapshot-identifier logjam-cutover-final
   aws rds wait db-snapshot-available --db-snapshot-identifier logjam-cutover-final
   ```

4. **The copy**, over the rehearsal's copy, with `COPY_REPLACE=1` and **without**
   `COPY_ALLOW_LIVE_SOURCE` (the second command in "Before the window" with that
   one entry removed, so a source that is not read-only stops the copy at once;
   measured 197 s for 1,764 MB on a scratch copy). Check: exit
   code `0` and `copy: ok: every check held` as the last log line. Row counts and
   sequence values are exact because the source is read-only; the log lists any
   difference. If it ends in
   `NOT VERIFIED`, do not go on: re-run it, and if it still fails, roll back (below).
5. **A full backup on the brain, and archiving green**, before any write reaches
   it. The nightly one is at 03:00; to take one now, on the host (run on a
   scratch copy: 66 seconds for 1.7 GB under load):

   ```sh
   brain 'systemctl start brain-backup-full && journalctl -u brain-backup-full --no-pager | tail -5'
   ```

   Check: the status file's `last_full_time` is now, and a new WAL object lands
   within a minute or two (brain.md, bring-up step 4).
6. **Merge the serving pull request** (`brain_serving = true`). Its apply sets
   the instance's serving tag, re-registers the four task definitions that have a
   database (the API's script task, both topo workers, the migrate task) to the
   brain's name with the certificate, and flips the deploy and rollback workflows
   to the brain. A few minutes. The brain's API starts within the release timer's
   30 seconds plus the image pull (49 s after the apply on a scratch copy). The
   deploy this merge triggers runs in "serving, not yet public" mode: it migrates
   the brain, writes `release.json`, and does not smoke-test (nothing public
   reaches the brain yet). Check, in the order each becomes true:
   - the apply is green, and
     `aws ecs describe-task-definition --task-definition logjam-api-migrate --query 'taskDefinition.containerDefinitions[0].environment'`
     shows the brain's `ec2-...compute.amazonaws.com` as `DB_HOST` and
     `DATABASE_SSL_CA=/app/brain-ca.pem` (on the RDS path that variable stays
     unset: the RDS certificate bundle in it breaks `prisma migrate deploy`);
   - the status file says `"serving": true` (the tag is on). At first its `api_sha`
     is **not** the merged head: the release agent starts whatever sha the
     existing `release.json` names, which is the previous release's;
   - the deploy run this merge triggered finishes green with its notice: it
     migrates the brain and writes `release.json` for the merged head;
   - only then, within the agent's 30 seconds, `api_sha` in the status file is
     the merged head. If it is not after two minutes, read
     `brain 'journalctl -u brain-release --no-pager | tail -20'`;
   - on the host, `brain 'curl -s -o /dev/null -w "%{http_code}" localhost/ready'`
     prints `200` (`/ready` needs no credentials; this is the only check of the
     brain before it is public, because CI cannot see it). It answered 22 to 49
     seconds after serving went on in the two rehearsals.

   **6a. Re-pin the topo task families**, once the apply is green. The apply put
   them on `:latest`, and `deploy-topo-worker.yml` cannot be started by hand
   (it would rebuild from `main`'s head by itself on the next green push). The
   workflow that repins without a rebuild:

   ```sh
   gh workflow run rollback.yml --ref main -f target=worker -f sha=$TOPO_SHA
   gh run watch
   ```

   (It refuses while a `deploy-topo-worker` run is queued or running.) Check both
   families carry the sha and the brain's name:

   ```sh
   for f in logjam-topo-worker logjam-topo-export-worker; do
     aws ecs describe-task-definition --task-definition $f \
       --query 'taskDefinition.containerDefinitions[0].[image,environment[?name==`DB_HOST`].value|[0]]' --output text
   done
   ```

   Each line ends `...:$TOPO_SHA` and the brain's name.
7. **Merge the public pull request** (`brain_public = true`). It changes no task
   definition. Its apply points CloudFront's API origin at the brain (the apply
   waits for the distribution to deploy: minutes, not measured), replaces the two
   log filters so they read the brain's log, and turns the Elastic Beanstalk
   health alarm's actions off. Its deploy runs in full and its smoke test waits
   up to 5 minutes for the public `/meta` to name the brain's sha (CloudFront can
   keep returning the old one for a while; the retries absorb it). The brain's
   security group admits only CloudFront on port 80, so a request straight to its
   address times out (rehearsed 2026-11-11, with `/ready` answering 200 through
   CloudFront). Check:
   - `curl -s https://api.logjamnsw.com/meta` names the merged sha, and
     `curl -s -o /dev/null -w '%{http_code}' https://api.logjamnsw.com/ready` is `200`;
   - sign in on Logjam Web and sync Logjam GPS; save a change in each;
   - the watchdog's latest line is `{"failed": []}` (`api_unready` clear);
   - the `Logjam/Api` `Responses5xx` metric still publishes (its filter now reads
     `/logjam/brain/api`).
8. **Prove a worker reaches the brain**, run one topo job end to end (a worker
   connects over verified TLS), then unfreeze `main`. Elastic Beanstalk stays up
   and idle with its sweeps off, and RDS stays read-only, for the rollback
   period, about US$10 a month (its instance cost US$9.82 in October). Nobody has
   checked a way to scale it down from this repository, so it is left running
   until the teardown; a deploy no longer touches it.

## Rolling back

Until users write to the brain a rollback is clean; after that, going back means
copying those writes into RDS, and once the smoke test has passed the honest
answer is to fix forward.

**The order is deliberate: RDS becomes writable only after the brain's API has
stopped.** The brain's sweeps run for as long as its API does, and a writable RDS
behind Elastic Beanstalk while the brain still sweeps is the two-sweepers hazard
in the box at the top: the brain would delete media that RDS has just confirmed.
So revert the pull requests first, check the brain's API is gone
(`brain 'docker ps --format "{{.Names}}"'` lists no `brain-api-1`, and the status
file says `"serving": false`), and only then make RDS writable, and only then turn
Elastic Beanstalk's sweeps back on. The serving revert's own deploy runs against
a still read-only RDS: its migrate step passes when no migration is pending and
the deploy goes on to Elastic Beanstalk; with one pending it fails at its first
insert, changes nothing, and Elastic Beanstalk keeps the release it has (measured
2026-11-11). Either way the API there writes nothing until RDS is writable.

| After step | What to undo, in this order | What is lost |
|---|---|---|
| 2 | `aws elasticbeanstalk update-environment --environment-name logjam-api-prod --options-to-remove Namespace=aws:elasticbeanstalk:application:environment,OptionName=TOPO_REAPER_INTERVAL_MS` (about 65 s) | nothing |
| 3 | Make RDS writable again. Only a session that is itself not read-only can: connect with `PGOPTIONS='-c default_transaction_read_only=off'` and run `ALTER DATABASE logjam RESET default_transaction_read_only;` (a plain session cannot, as it inherits the setting; run on a scratch copy). Sweeps back on as above. The snapshot can stay | nothing: no write reached the brain |
| 4, 5 | Nothing changed that matters: the brain is not serving. Re-run the copy with `COPY_REPLACE=1` when ready; otherwise as step 3 | nothing |
| 6 (and 6a) | Revert the serving pull request (instance tag `off`: the release agent removes the API container within its 30 s tick; the four task definitions go back to RDS; the workflows go back to Elastic Beanstalk; the revert's merge deploys `main`'s head to it). Then **repin the topo families** the same way as 6a (`rollback.yml`, `target=worker`, `sha=$TOPO_SHA`: the revert put them back on `:latest` with RDS's settings). Then, once the brain's API is gone, by hand: RDS writable (as for step 3), then Elastic Beanstalk's sweeps back on, in that order. The re-registered task definitions carry no `DATABASE_SSL_CA`: do not set one by hand | anything a topo task or the brain's API wrote to the brain after the flip is not on RDS |
| 7 | Revert the public pull request first (CloudFront's origin back to Elastic Beanstalk; the apply waits), then as for step 6. | everything written to the brain since the flip |

A rollback to a release built before the certificate was bundled will not start
on the brain: only roll back to releases built after.

## The days after

- **Watch**, daily for a week: the watchdog's latest line, the alarm emails
  ([alarms.md](alarms.md)), `logjam-api-5xx`, the status file, and that the 03:00
  full backup and the 04:30 drill ran on the real data (`last_full_time` and
  `drill.json`). The budget alert `logjam-monthly` (US$50) will fire while both
  stacks run; that is expected, estimated near US$60 a month, and the cost ceiling
  at US$100 is the backstop ([alarms.md](alarms.md#cost-ceiling)).
- **RDS and Elastic Beanstalk are the only way back, and they go once the
  brain has proved itself.** The cutover issue (#434) suggested 30 days;
  Logjam is in beta with no promise to its users, so the maintainer decided
  against a waiting period (2026-11-11). Before removing them: a regression
  and smoke sweep of prod on the brain, and, since it costs one night, the
  first 03:00 full backup and one green 04:30 drill on the real data
  (`last_full_time` and `drill.json`): that drill is the first proof that
  prod's own data restores. Elastic Beanstalk is left running meanwhile
  (step 8).
- **The teardown is two pull requests, drafted ahead** (branches
  `feat/brain-rds-deletable`, then `feat/brain-teardown`). The first only
  lets the database be deleted: AWS refuses while deletion protection is on,
  and Terraform deletes with the settings last applied, so those change in a
  merge of their own. From that merge on, one click deletes the database. The
  second removes: the RDS
  instance (`rds.tf`: with `delete_automated_backups = true` and
  `skip_final_snapshot = true` first, so neither its automated backups nor a new
  final snapshot outlives it), its parameter group and alarms (`logjam-rds-*`),
  the RDS pgaudit subscription, and the RDS CA bundle in `api/Dockerfile`; the
  cutover snapshot and `logjam-db-enc-final`, deleted by hand with
  `aws rds delete-db-snapshot`, then a check by hand that no manual snapshot
  or retained backup remains; the Elastic Beanstalk environment (`eb.tf`, `api/.ebextensions`, the
  EB steps of `deploy-api.yml` and `rollback.yml`, the live-sha lookup's
  Elastic Beanstalk arm in `infra/scripts/brain-setting.sh`, the
  `api_environment_degraded` alarm and the Elastic Beanstalk arm of
  `local.api_log_group`); the copy task (`brain_copy.tf`) and the RDS arm of
  `local.db_environment` in `ecs.tf`; the Elastic Beanstalk text in
  [queries.md](queries.md) and [rollback.md](rollback.md); then supersede
  [ADR 0001](../decisions/0001-rds-tls-via-bundled-ca.md), and remove the RDS
  lines from [the data-access policy](../DATA-ACCESS-POLICY.md) and change its
  date. `docs/architecture.md` is rewritten for the brain by the go-public pull
  request, not here.
