# Rolling back a release

Logjam has one rollback path: the **Rollback** workflow
(`.github/workflows/rollback.yml`). This page explains how to use it and, for
when GitHub Actions or its sign-in to AWS is itself down, gives the same
steps as plain AWS CLI commands.

## What can be rolled back, and how

| Target | What changes | What does not |
|---|---|---|
| `api` | Elastic Beanstalk goes back to the application version labelled with the commit sha, and the two ECS task definitions that run the API image (`logjam-api-migrate`, `logjam-geo-pdf-worker`) are repinned to that sha's image | The database. There are no down-migrations: the schema stays at the newer version, which is why every migration must be expand/contract ([ADR 0003](../decisions/0003-pre-deploy-migrations-expand-contract.md)) and why CI runs `rollback-compat` on migration PRs |
| `frontend` | `index.html` is replaced by the copy kept at `releases/<sha>/index.html` in the frontend bucket | Hashed assets: every release's assets stay in the bucket for at least 30 days, so the old `index.html` finds its files |
| `worker` | The topo task definitions (`logjam-topo-worker`, `logjam-topo-export-worker`) are repinned to the `logjam-topo-worker:<sha>` image | Anything already running: a rollback affects the next task launched |

Limits:

- **API and worker:** ECR keeps the newest 15 images per repository. A sha
  whose image has been expired cannot be rolled back to.
- **Frontend:** a release is kept for 30 days after it was last deployed, plus
  always the live release and the one before it. Releases deployed before
  this mechanism existed have no `releases/<sha>/` copy and cannot be rolled
  back to.
- **Worker shas:** a worker image exists only for commits that changed `topo/`.
  The sha to roll back to is the tag the task definition carried before.
- **The next deploy undoes a rollback.** The next green push to `main`
  deploys `main`'s head. To keep a rollback, revert the change on `main`.

## Finding the sha to roll back to

- **API:** the live sha is `curl -s https://api.logjamnsw.com/meta | jq -r .sha`.
  The previous one is in the Elastic Beanstalk console (Application versions)
  or: `aws elasticbeanstalk describe-events --environment-name logjam-api-prod --max-items 50`.
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
change to finish, then runs the same smoke test a deploy runs. It shares the
target's deploy concurrency group, so it waits for a running deploy and a
deploy waits for it.

### Automatic rollback

`deploy-api.yml` and `deploy-frontend.yml` run a smoke test after deploying:

- API: `https://api.logjamnsw.com/health` answers and `/meta` reports the
  deployed sha.
- Frontend: `https://logjamnsw.com/` serves the deployed release's
  `index.html`, and the entry script it names loads.

If the smoke test fails, the deploy calls the Rollback workflow for the
release that was live before it. If that rollback's own smoke test fails, it
stops: nothing retries, and a person takes over from here. The deploy run is
red either way.

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

Repinning a task definition uses the repo's own script, which needs `jq`:
`infra/scripts/pin-ecs-task-image.sh <family> <image>`. It copies the live
task definition, changes only the image and registers it as a new revision.

### API

```sh
# 1. The release must still exist.
aws elasticbeanstalk describe-application-versions --application-name "$EB_APP" \
  --version-labels "$SHA" --query 'ApplicationVersions[0].VersionLabel' --output text
aws ecr describe-images --repository-name logjam-api --image-ids imageTag="$SHA"

# 2. Repin the task definitions that run the API image.
for family in logjam-api-migrate logjam-geo-pdf-worker; do
  infra/scripts/pin-ecs-task-image.sh "$family" "$REGISTRY/logjam-api:$SHA"
done

# 3. Swap Elastic Beanstalk back. Single instance: the API is down during the
#    swap and comes back cold, usually within two minutes.
aws elasticbeanstalk update-environment --environment-name "$EB_ENV" --version-label "$SHA"
aws elasticbeanstalk wait environment-updated --environment-names "$EB_ENV"

# 4. Check.
curl -s https://api.logjamnsw.com/health
curl -s https://api.logjamnsw.com/meta | jq -r .sha   # must print $SHA
```

Never run a migration as part of an API rollback.

### Frontend

```sh
# 1. The release and every file it shipped must still be in the bucket.
aws s3 cp "s3://$BUCKET/releases/$SHA/files.txt" /tmp/files.txt
aws s3api list-objects-v2 --bucket "$BUCKET" --output json | jq -r '.Contents[].Key' | sort > /tmp/present.txt
sort /tmp/files.txt | comm -23 - /tmp/present.txt   # must print nothing

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
for family in logjam-topo-worker logjam-topo-export-worker; do
  infra/scripts/pin-ecs-task-image.sh "$family" "$REGISTRY/logjam-topo-worker:$SHA"
done
```

## What is not rolled back here

- **The database.** Fix forward. For a disaster, restore RDS to a new
  instance from a point in time (hours; data since that point is lost).
- **Mobile.** An over-the-air update is rolled back by republishing the
  previous update group on its channel (`eas update:republish`). An installed
  binary cannot be rolled back; ship a fix.
- **Terraform.** Revert the PR, merge, apply. A destroyed stateful resource is
  not revertible; `prevent_destroy`, RDS deletion protection and snapshots
  are the net.

## After a rollback

- Record what happened and how long it took in [drills.md](drills.md) if it
  was a drill, or in the incident notes if it was real.
- Revert or fix the bad change on `main` before the next merge, or the next
  deploy ships it again.
