# Deleting the old LiDAR jobs

A one-off: every LiDAR job from before new jobs sharpened their area (a
`topo_jobs` row with `sharpen` null) is deleted, with its files, its shares
and its owner's storage charge, as `DELETE /topo-jobs/:id` deletes one. The
maintainer decided they go with no notice (beta, no data guarantee before
release). The script is `api/src/scripts/purgeLegacyTopoJobs.ts`; nothing
runs it but this page.

## What it deletes, and what it leaves

For each `complete` or `failed` row with `sharpen` null:

- the topo bucket's objects under `inputs/<id>/`, `outputs/<id>/` and
  `jobs/<id>/`;
- its shares, and the share notifications its sharees got;
- the row;
- its owner's `storage_used_bytes`, by the row's `output_bytes`;
- any export still queued from it is failed (none can be queued since #641).

S3 goes first, then the rest in one transaction, so a job that fails keeps its
row and a rerun finishes it.

It leaves `uploading`, `pending` and `processing` rows (an uploading one may
be a new job not yet started), a job a running export reads, the owner's own
notifications that name a deleted job, and overlays already saved on phones.
Unfinished rows are counted as `skippedUnfinished` and jobs a running export
reads as `skippedExporting`; notifications and phone overlays are not counted.

## Run it

Only once the script is in the live API image (after the deploy that ships
it), and only with the maintainer's yes for this run.

It runs as an announcement does, as a one-off Fargate task on the live API
image, with the maintainer's AWS access in `ap-southeast-2`. Define
`announce_task` from [announcements.md](announcements.md#in-prod), then:

```sh
purge_task() {
  announce_task "$(jq -n --arg yes "${1:-}" '{containerOverrides: [{
    name: "api-script",
    command: (["node", "dist/scripts/purgeLegacyTopoJobs.js"]
              + (if $yes == "" then [] else [$yes] end))
  }]}')"
}

purge_task          # counts, deletes nothing
purge_task --yes    # deletes, after reading the counts
```

## What it prints

JSON log lines:

- `legacy_topo_jobs_checked` (dry run) or `legacy_topo_jobs_purging`
  (`--yes`), with `jobs`, `owners`, `outputBytes`, `skippedUnfinished` and
  `skippedExporting`;
- `legacy_topo_jobs_purged` with `deleted` and `failed`;
- `legacy_topo_job_purge_failed` with the job id, for each job that failed.

**Expected noise:** one error-level `s3_abort_multipart_failed` per job. The
task role (`aws_iam_policy.topo_worker` in `infra/terraform/envs/prod/iam.tf`)
can delete objects but not list or abort multipart uploads, and the delete
logs and swallows that refusal. A finished job has no open upload, and the
bucket's lifecycle rule aborts stragglers, so nothing is left behind.

A run with any failed job exits 1: a stopped task with a non-zero exit in
`logjam-cluster`, which counts towards the `logjam-worker-failures` alarm
([alarms.md](alarms.md#logjam-worker-failures)). Rerun it: deleted jobs are
gone, and the failed ones are picked up again.

The task connects as the application's database role. Its record is the
`RunTask` call in CloudTrail, command included, in the write-once audit log
([DATA-ACCESS-POLICY.md](../DATA-ACCESS-POLICY.md)).
