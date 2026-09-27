# Deploy and rollback drills

A drill proves the rollback mechanism works: the workflows, the AWS
permissions, and how long each step takes. It does not prove a rollback is
*safe* (that the older code works on the newer schema); `rollback-compat`
checks that on every migration PR.

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
- [ ] **Serialized:** a rollback dispatched while a deploy of the same target
      runs waits for it.

### Automatic rollback

- [ ] **Frontend:** set the repository variable `PROD_WEB_URL` to a URL
      that 404s, then merge a change under `frontend/`. The deploy's smoke
      test fails, the rollback job returns to the previous release, its own
      smoke test fails the same way, and the run stops there: no further
      rollback, no retry. Restore the variable (`scripts/github-settings.sh
      --apply`) and roll forward with `rollback.yml`. Time from smoke failure
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

## Records

<!-- Newest first. Date, who, the change under test, times, surprises. -->

None yet.
