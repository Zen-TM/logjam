# Rolling back a release

Logjam has one rollback path: the **Rollback** workflow
(`.github/workflows/rollback.yml`). This page explains how to use it and, for
when GitHub Actions or its sign-in to AWS is itself down, gives the same
steps as plain AWS CLI commands.

**Which API path applies is decided by `brain_serving` in
`infra/terraform/envs/prod/brain.auto.tfvars`** (the same file the deploy and
rollback workflows read). While it is `false`, the API runs on Elastic
Beanstalk and everything below that mentions Elastic Beanstalk is how it goes
back. Once it is `true` (after the cutover to the self-managed host called the
brain), the API runs on the brain, Elastic Beanstalk idles and is **not**
touched by a rollback, and the brain's path applies instead. Read the file on
`main` before you start: `grep brain_serving infra/terraform/envs/prod/brain.auto.tfvars`.

## What can be rolled back, and how

| Target | What changes | What does not |
|---|---|---|
| `api`, `brain_serving` off | Elastic Beanstalk goes back to the application version labelled with the commit sha, and the ECS task definitions that run the API image (listed in `infra/scripts/pin-release.sh`) are repinned to that sha's image |
| `api`, `brain_serving` on | The same task definitions are repinned, and the brain's release pointer (`release.json` in its signals bucket: the sha and the API's environment as that sha shipped it) is rewritten for the sha; the brain's release agent then makes its API match, within about a minute. Elastic Beanstalk is not touched | The database. There are no down-migrations: the schema stays at the newer version, which is why every migration must be expand/contract ([ADR 0003](../decisions/0003-pre-deploy-migrations-expand-contract.md)) and why CI runs `rollback-compat` on migration PRs |
| `frontend` | `index.html` is replaced by the copy kept at `releases/<sha>/index.html` in the frontend bucket | Hashed assets: every release's assets stay in the bucket for at least 30 days, so the old `index.html` finds its files. Unhashed files from `frontend/public/` (`privacy.html`, `tos.html`, `manifest.webmanifest`, `templates/`) are not restored: they keep the newer release's content |
| `worker` | The topo task definitions (listed in `infra/scripts/pin-release.sh`) are repinned to the `logjam-topo-worker:<sha>` image | Anything already running: a rollback affects the next task launched |

Limits:

- **API and worker:** ECR keeps the newest 15 releases per repository. A sha
  whose image has been expired cannot be rolled back to.
- **API on the brain:** the sha must have an `infra/brain/api.env` (a release
  from before the brain has none, and the workflow stops with an error) and its
  image must carry the brain's certificate at `/app/brain-ca.pem` (an older one
  fails at start with "DATABASE_SSL_CA points to a missing file"). Go back only
  to a release built after the certificate was bundled.
- **API, architecture:** the API image is built for amd64 and arm64
  (`deploy-api.yml`). A release built before that is amd64 only: it still runs
  on Elastic Beanstalk and Fargate, but not on an arm64 host.
- **API, schema:** `rollback-compat` tests a migration only against the
  release that was live when the migration PR ran. Going back more than one
  release can cross a contract migration that dropped something the older
  code reads. Before going back further, read `api/prisma/migrations/`
  between the target sha and the live one
  (`git diff --stat <sha> <live sha> -- api/prisma/migrations`).
- **API, releases built before `/meta` reported a sha** return `"sha": null`.
  Rolling back to one works, but its smoke test fails: check `/health` by
  hand, and (with `brain_serving` off) read the live sha from the Elastic
  Beanstalk version label instead.
- **Frontend, unhashed files:** see the table. If a rolled-back release
  changed `privacy.html` or `tos.html`, users see the newer text while the API
  (rolled back separately) may still name the older consent version; fix
  forward instead.
- **Frontend:** a release is kept for 30 days after it was last deployed
  (a rollback to it does not reset that clock), plus always the live release
  and the one before it. Releases deployed before
  this mechanism existed have no `releases/<sha>/` copy and cannot be rolled
  back to.
- **Worker shas:** a worker image exists only for commits that changed `topo/`.
  The sha to roll back to is the tag the task definition carried before.
- **The next deploy undoes a rollback.** The next green push to `main`
  deploys `main`'s head. To keep a rollback, revert the change on `main`.
- **ECR's `:latest` still names the rolled-back-from image.** The Terraform
  task definitions in `infra/terraform/envs/prod/ecs.tf` say `:latest`, so a
  `terraform apply` that touches one before `main` is reverted re-registers
  the bad image. After such an apply, repin with the worker or API command
  below; do not re-run the deploy workflow, which ships `main`'s head.

## Finding the sha to roll back to

- **API:** the live sha is `curl -s https://api.logjamnsw.com/meta | jq -r .sha`
  (`null` for a release built before `/meta` reported one). With
  `brain_serving` off the Elastic Beanstalk version label is the same sha, and
  the previous one is in the Elastic Beanstalk console (Application versions)
  or: `aws elasticbeanstalk describe-events --environment-name logjam-api-prod --max-items 50`.
  With `brain_serving` on the Elastic Beanstalk label is stale (nothing deploys
  there any more): the previous release is the one named in the last green
  **Deploy API** run's log (its guard job's "What is live?" step), or the
  commit before the bad one on `main` that has an `infra/brain/api.env`.
- **Frontend:** the live sha is the `release-sha` metadata on `index.html`:
  `aws s3api head-object --bucket <frontend bucket> --key index.html --query Metadata`.
  Kept releases are listed by `aws s3 ls s3://<frontend bucket>/releases/`.
- **Worker:** `aws ecs describe-task-definition --task-definition logjam-topo-worker:<revision> --query 'taskDefinition.containerDefinitions[0].image'`
  for an earlier revision (`aws ecs list-task-definitions --family-prefix logjam-topo-worker --sort DESC`).
- Every deploy run's log names both the sha it deployed and the one that was
  live before it (the guard job's "What is live?" step).

## The normal way: the Rollback workflow

GitHub → Actions → **Rollback** → Run workflow, on `main` (the `prod`
environment accepts only `main`), with the target and the full 40-character
sha. Or: `gh workflow run rollback.yml --ref main -f target=api -f sha=<sha>`.

It checks the release still exists before changing anything, waits for the
change to finish, then runs the same smoke test a deploy runs. For the brain
the smoke test gives the host's release agent 5 minutes (not 3) to show the sha
on `/meta`; while `brain_public` is still `false` the public URL is Elastic
Beanstalk's, so no smoke test can see the brain and the run says so: check it
through the host instead.

It refuses to start while a deploy of the same target is queued or running:
run it again once that deploy has finished. (GitHub keeps only one waiting run
per concurrency group, so a rollback left waiting behind a deploy would be
cancelled by the next push's deploy.) Once it runs, it holds the target's
deploy concurrency group, and deploys wait for it. **Check the run actually
ran:** a deploy that starts in the same moment can still cancel it, and a
cancelled run is grey, not red.

### Automatic rollback

`deploy-api.yml` and `deploy-frontend.yml` run a smoke test after deploying:

- API: `https://api.logjamnsw.com/health` answers and `/meta` reports the
  deployed sha (for up to 5 minutes when the brain serves, 3 otherwise).
- Frontend: `https://logjamnsw.com/` serves the deployed release's
  `index.html`, and the entry script it names loads.

If the smoke test fails, the deploy calls the Rollback workflow for the
release that was live before it. If that rollback's own smoke test fails, it
stops: nothing retries, and a person takes over from here. The alarms in
[alarms.md](alarms.md) are what tell them. The deploy run is
red either way.

A smoke test whose every request returns 403 from the first attempt is most
likely the edge WAF blocking the GitHub runner's IP (the AWS IP reputation
list), not a broken release: check the web ACL's sampled requests before
anything else. The smoke log prints the status of every request.

The worker has no smoke test (its tasks run on demand, with nothing
listening to probe), so it is never rolled back automatically.

## By hand: plain AWS CLI

For when GitHub Actions or OIDC is down. Run with credentials for the prod
account in `ap-southeast-2`. Each block mirrors a step of `rollback.yml`;
check the release exists before changing anything.

Set these first. The names are in `infra/terraform/envs/prod`, and
`terraform output` there prints the bucket and distribution id.

```sh
export AWS_REGION=ap-southeast-2
SHA=<full 40-character sha>
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGISTRY=$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com
EB_APP=logjam
EB_ENV=logjam-api-prod
BUCKET=<terraform output s3_bucket_frontend>
DISTRIBUTION=<terraform output web_cloudfront_distribution_id>
```

Repinning uses the repo's own script, which needs `jq`:
`infra/scripts/pin-release.sh <image>` repins every task definition that runs
that image's repository. For each, it copies the live task definition,
changes only the image and registers it as a new revision.

### API, with `brain_serving` off (Elastic Beanstalk)

```sh
# 1. The release must still exist.
aws elasticbeanstalk describe-application-versions --application-name "$EB_APP" \
  --version-labels "$SHA" --query 'ApplicationVersions[0].VersionLabel' --output text
aws ecr describe-images --repository-name logjam-api --image-ids imageTag="$SHA"

# 2. Repin the task definitions that run the API image.
infra/scripts/pin-release.sh "$REGISTRY/logjam-api:$SHA"

# 3. Swap Elastic Beanstalk back once it is Ready (it refuses an update while
#    another is under way). Single instance: the API is down during the swap
#    and comes back cold, usually within two minutes.
aws elasticbeanstalk wait environment-updated --environment-names "$EB_ENV"
aws elasticbeanstalk update-environment --environment-name "$EB_ENV" --version-label "$SHA"
aws elasticbeanstalk wait environment-updated --environment-names "$EB_ENV"

# 4. Check.
curl -s https://api.logjamnsw.com/health
curl -s https://api.logjamnsw.com/meta | jq -r .sha   # $SHA, or null for a release built before /meta reported one
```

Never run a migration as part of an API rollback.

### API, with `brain_serving` on (the brain)

Elastic Beanstalk plays no part. The brain runs whatever its release pointer
names, so the rollback is the pointer plus the task definitions. Run from a
checkout of the repository (for the two scripts and the sha's `api.env`),
with credentials that can write the signals bucket.

```sh
SIGNALS=logjam-brain-signals-$ACCOUNT

# 1. The release must still exist, and must have an environment file (a sha
#    from before the brain has none: stop, it cannot be rolled back to).
aws ecr describe-images --repository-name logjam-api --image-ids imageTag="$SHA"
git fetch origin "$SHA"
git cat-file -e "$SHA:infra/brain/api.env"

# 2. Repin the task definitions that run the API image (the migrate and
#    script tasks; they keep pointing at the brain).
infra/scripts/pin-release.sh "$REGISTRY/logjam-api:$SHA"

# 3. Write the pointer: the sha and the environment that sha shipped. The
#    script refuses a malformed env file; make the file first, so a failure
#    never uploads an empty pointer.
git show "$SHA:infra/brain/api.env" > /tmp/api.env
infra/scripts/brain-release.sh "$SHA" /tmp/api.env > /tmp/release.json
aws s3 cp /tmp/release.json "s3://$SIGNALS/release.json" --content-type application/json

# 4. Wait for the brain: its release agent acts within 30 seconds, then pulls
#    the image if the host does not have it (a minute or two). Check, over and
#    over, until /meta names $SHA.
curl -s https://api.logjamnsw.com/health
curl -s https://api.logjamnsw.com/meta | jq -r .sha   # $SHA
```

If `/meta` still shows another sha after five minutes, read the brain's
`status.json` (`aws s3 cp "s3://$SIGNALS/status.json" -`): its `api_sha` is what
the host runs, and the host's release agent log is on the brain (Session
Manager, `journalctl -u brain-release`). While `brain_public` is `false`,
`/meta` on the public URL is still Elastic Beanstalk's: check `status.json`
instead.

### Frontend

```sh
# 1. The release and every file it shipped must still be in the bucket.
aws s3 cp "s3://$BUCKET/releases/$SHA/files.txt" /tmp/files.txt
# LC_ALL=C: the deploy wrote files.txt in C order, and comm needs both sides
# in one order; a locale sort reports files missing that are there.
aws s3api list-objects-v2 --bucket "$BUCKET" --output json | jq -r '.Contents[].Key' | LC_ALL=C sort > /tmp/present.txt
LC_ALL=C sort /tmp/files.txt | LC_ALL=C comm -23 - /tmp/present.txt   # must print nothing

# 2. Put its index.html back. REPLACE drops the source's headers, so restate them.
aws s3 cp "s3://$BUCKET/releases/$SHA/index.html" "s3://$BUCKET/index.html" \
  --metadata-directive REPLACE --metadata "release-sha=$SHA" \
  --content-type text/html --cache-control "no-cache, no-store, must-revalidate"

# 3. Invalidate and wait.
ID=$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" \
  --paths /index.html / --query Invalidation.Id --output text)
aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION" --id "$ID"

# 4. Check: the two must be identical.
diff <(curl -s https://logjamnsw.com/) <(curl -s "https://logjamnsw.com/releases/$SHA/index.html")
```

### Worker

```sh
aws ecr describe-images --repository-name logjam-topo-worker --image-ids imageTag="$SHA"
infra/scripts/pin-release.sh "$REGISTRY/logjam-topo-worker:$SHA"
```

## What is not rolled back here

- **The database.** Fix forward. For a disaster, restore RDS to a new
  instance from a point in time (hours; data since that point is lost).
- **Mobile.** An over-the-air update is rolled back by republishing the
  previous update group on its channel (`eas update:republish`). An installed
  binary cannot be rolled back; ship a fix.
- **The cutover itself.** Going back from the brain to Elastic Beanstalk is
  reverting the `brain_public` and `brain_serving` lines of `brain.auto.tfvars`
  (in that order) and some hand steps; writes made on the brain are not on
  RDS. That is the cutover runbook's, not this page's.
- **Terraform.** Revert the PR, merge, apply. A destroyed stateful resource is
  not revertible; `prevent_destroy`, RDS deletion protection and snapshots
  are the net.

## After a rollback

- Record what happened and how long it took in [drills.md](drills.md): under
  Records for a drill, under Real rollbacks otherwise. If user data may have
  been exposed, [incident-response.md](../incident-response.md) applies too.
- Revert or fix the bad change on `main` before the next merge, or the next
  deploy ships it again.
