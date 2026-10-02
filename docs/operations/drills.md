# Deploy and rollback drills

A drill proves the rollback mechanism works: the workflows, the AWS
permissions, and how long each step takes. It does not prove a rollback is
*safe* (that the older code works on the newer schema); `rollback-compat`
checks that on every migration PR, for the release live at the time.

**When:** after any change to a `deploy-*.yml`, `deploy-guard.yml`,
`smoke.yml` or `rollback.yml` (a changed mechanism is an untested one),
quarterly, and at the first tagged mobile release for the OTA rollback. Pick
a quiet hour: each API step is a cold Elastic Beanstalk restart, a minute or
two of downtime.

Copy the checklist into a new record at the bottom, tick it as you go, and
note times and surprises. [rollback.md](rollback.md) has the commands.

## Checklist

### Before

- [ ] At least two releases of each target have deployed since the change
      under test. A release deployed before `/meta` reported a sha, or before
      the frontend kept `releases/<sha>/`, cannot be a rollback target: its
      smoke test would fail on a healthy release.
- [ ] Note the live sha of each: API `curl -s https://api.logjamnsw.com/meta | jq -r .sha`;
      frontend `release-sha` on `index.html`; worker image tag on
      `logjam-topo-worker`. Note the release before each.
- [ ] Any Terraform the change needs has been applied.

### Deploy guards

- [ ] A deploy run's guard job logs the live release and `proceed=true`.
- [ ] **Stale:** merge two PRs in quick succession. The first run's guard
      reports "Skipped, stale" and the second deploys. The second waits
      (pending) while the first holds the concurrency group.
- [ ] **Scope against live:** merge a PR touching `frontend/`, then at once a
      docs-only PR. The frontend change reaches prod (the second run's range
      from the live release includes it).
- [ ] **Nothing to deploy:** a docs-only merge skips the frontend and worker
      with "Skipped, nothing to deploy" and still deploys the API.
- [ ] The frontend deploy writes `releases/<sha>/index.html` and
      `files.txt`, sets `release-sha` on `index.html`, and its prune step
      either prunes or says why not.

### Rollback workflow, each target back one release and forward

- [ ] **API back:** `rollback.yml` target `api`, the previous sha. EB swaps,
      both task definitions carry the old image, the smoke test passes.
      Time from dispatch to green: ____
- [ ] **API forward:** the same with the newest sha. Time: ____
- [ ] **Frontend back and forward.** Times: ____ / ____
- [ ] **Worker back and forward.** `logjam-topo-worker` and
      `logjam-topo-export-worker` carry the chosen tag. Times: ____ / ____
- [ ] **Refusals change nothing:** a short sha fails the sha check; a sha
      with no ECR image (or no `releases/<sha>/`) fails before any swap.
- [ ] **Refused while a deploy is busy:** a rollback dispatched while a
      deploy of the same target is queued or running fails its preflight job
      and changes nothing. A deploy that starts while a rollback runs waits
      for it.
- [ ] **Missing config fails closed:** unset the repository variable
      `PROD_WEB_URL`, merge a change under `frontend/`. The guard goes red with
      "must be set", the deploy job is skipped, nothing in the bucket changes.
      Restore it by hand with its value from `infra/terraform/envs/github`;
      the next plan of that root then shows no change.
- [ ] **No-op CI runs stay out of the group:** while a deploy runs and
      another waits, a PR's CI finishing starts a deploy run that skips
      without cancelling the waiting one.

### Automatic rollback

- [ ] **Frontend:** set the repository variable `PROD_WEB_URL` to a URL
      that 404s, then merge a change under `frontend/`. The deploy's smoke
      test fails, the rollback job returns to the previous release, its own
      smoke test fails the same way, and the run stops there: no further
      rollback, no retry. Restore the variable by hand as above and roll
      forward with `rollback.yml`. Time from smoke failure
      to rolled back: ____
- [ ] **API (optional, three cold restarts):** the same with the API probe.
- [ ] Nothing pages yet on a failed rollback: until the CloudWatch 5xx and
      crash-loop alarms exist, the signal is the red run and GitHub's failure
      email. Confirm that email arrived.

### Manual fallback

- [ ] Roll the frontend back and forward once with the plain CLI commands in
      [rollback.md](rollback.md), with credentials that are not the GitHub
      role. Any command that does not work as written is fixed in that page.

### rollback-compat

- [ ] A scratch PR adding a migration that drops a column the live release
      reads (for example `ALTER TABLE "users" DROP COLUMN "vector_style";`)
      turns `Rollback compat` red. Close it unmerged.

### After

- [ ] Every target is back on `main`'s head.
- [ ] Surprises are fixed, or filed as issues, and listed below.

## Apply refusal

Proves `terraform-apply.yml` refuses a plan other than the one the PR showed,
for both kinds of hand change ([0026](../decisions/0026-plan-fingerprint-covers-planned-values.md)).
**When:** after a change to `infra/scripts/plan-summary.mjs`, `terraform-plan.yml`
or `terraform-apply.yml`, and before flipping the repository variable
`PLAN_VALUE_CHECK` from `report` to `enforce`. The key is the repository
secret `PLAN_FINGERPRINT_KEY`. Use a harmless one-tag change in
`infra/terraform/envs/prod` as the PR, and undo every hand edit afterwards.

- [ ] **Drift on a resource the PR does not touch** (refuses now, in either
      mode). After the PR's plan comment posts, add a tag by hand to a
      resource the PR does not change, then merge. The apply refuses with
      "is not the plan on the PR" and applies nothing. This works only if the
      hand edit shows up in the plan at merge, so pick a resource with that
      attribute in Terraform.
- [ ] **Drift on a resource the PR updates** (the case #268 found). After the
      plan comment posts, add a tag by hand to the resource the PR is
      updating, then merge.
  - With `PLAN_VALUE_CHECK` = `report`: the apply goes ahead, and the result
    comment and the run's job summary say "Value check (report only)" and
    name that resource, without its values. The hand tag is reverted by the
    apply: re-add it afterwards.
  - With `enforce`: the apply refuses with "different values on 1
    resource(s)", names the resource, shows no values, and applies nothing.
- [ ] **No key fails closed in enforce:** with `enforce`, a run whose secret
      is unset refuses ("cannot be compared"); under `report` it applies and
      says the check did not run.
- [ ] The plan comment carries a `plan-values` line of `address → 16 hex` and
      nothing else about values. Confirm no value, tag or name appears in it.

Time: ____ Surprises: ____

## Records

<!-- Newest first. Date, who, the change under test, times, surprises. -->

### 2026-10-02: maintainer and Lead (Claude), first full drill

**Change under test:** the whole mechanism (Phase 3: deploy guards, `rollback.yml`, smoke, auto-rollback, `rollback-compat`, the plan fingerprint).

**Rollback workflow** (dispatch to green):

| Target | Back | Forward |
|---|---|---|
| API (a0b59ddb ↔ 6eb9ea77) | 116 s | 109 s |
| Frontend (eb0f9634 ↔ 1e6bf7fb) | 98 s | 64 s |
| Worker (d745267f ↔ 7b304a9e) | 41 s | 37 s |

- The API rollback repinned `logjam-api-migrate` and `logjam-geo-pdf-worker` with EB; the topo task definitions were untouched. The worker rollback repinned both topo task definitions.
- **Refusals:** a short sha ("must be a full 40-character commit sha"), a worker sha with no ECR image, and a frontend sha with no `releases/<sha>/` all failed before any change.
- **Busy:** a frontend rollback dispatched while #274's frontend deploy was queued failed its preflight ("has a run queued or in progress") and changed nothing.
- **Missing config:** with `PROD_WEB_URL` deleted, merging #272 turned the guard red ("must be set … Nothing was deployed"); the bucket was unchanged. Restored by hand; #271's `plan-github` then showed no variable change.
- **Automatic rollback (frontend):** with `PROD_WEB_URL` pointing at a 404, re-running #272's deploy deployed 767d364e, the smoke test failed after its retries (3 min 14 s), and the rollback restored eb0f9634 42 s later. No retry, no loop. **Surprise:** the rollback's own smoke test was *skipped*, not failed: its plain `if:` took GitHub's implicit `success()`, and the skipped preflight skipped it. Nothing checked the restored release. Fixed in #274. Rolled forward with `rollback.yml` (64 s, smoke ran).
- **Manual fallback:** frontend back (40 s) and forward (39 s) with the CLI block in [rollback.md](rollback.md), with the maintainer's credentials. **Surprise:** the file check sorted in the reader's locale while `files.txt` is in C order, so `comm` reported a file missing that was present. Fixed in #275 (`LC_ALL=C`).
- **rollback-compat:** #273 (drop `users.vector_style`) turned "Live release on this schema" red (the live release's integration suite got 500s). Closed unmerged.
- **Deploy guards:** "nothing to deploy" held on every docs- or infra-only merge (#264, #267, #275: frontend and worker skipped, API deployed). **Not exercised:** "stale" and "scope against live". Main requires an up-to-date branch, so a second merge waits for its own CI, and the first merge's deploy (about 3 minutes after merge) had already run. "No-op CI runs" was not observed either.
- **Failure email** for the failed auto-rollback run: maintainer to confirm it arrived.
- **After:** API on main's head (04dcf7d6); frontend and worker on f754e913, the last commit touching their paths.

**Apply refusal** (before the section above existed): #268 added a tag to `aws_sns_topic.alerts` and a tag was added to the same topic by hand before merge. The apply **applied** and reverted the hand tag: the fingerprint then covered only addresses and actions. That led to [0026](../decisions/0026-plan-fingerprint-covers-planned-values.md) (#271, report mode). #270 repeated it with the hand tag on the web CloudFront distribution, which the PR did not touch: the apply refused ("not the plan on the PR … Nothing applied"); after removing the hand tag, a re-run applied exactly the PR's change.

## Real rollbacks

<!-- Newest first. Date, who, target and shas, why, how long, what followed
(the fix or revert on main). -->

None yet.
