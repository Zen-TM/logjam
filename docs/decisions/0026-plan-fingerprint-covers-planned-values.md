# 0026. The apply compares an HMAC of each changed resource's planned values, reporting first and refusing once trusted

- **Date:** 2026-10-02
- **Status:** Accepted
- **Supersedes:** [0024](0024-prod-terraform-applies-on-merge-by-plan-fingerprint.md)

## Context

[0024](0024-prod-terraform-applies-on-merge-by-plan-fingerprint.md) made
merging the apply gate for `infra/terraform/envs/prod`, with one rule: the
plan at merge must be the plan the PR showed. It decided "the same plan" means
the same sorted `(address, actions)` list plus each Lambda's
`source_code_hash`, and no attribute values, because plan JSON holds
sensitive values in clear, the PR comment is public, and a plain hash of a
low-entropy value can be brute-forced. [0025](0025-github-settings-in-terraform.md)
extended the same gate to `infra/terraform/envs/github`.

The apply-refusal drill (#268) showed what that leaves open. #268's plan
updated the `aws_sns_topic.alerts` tags. The drill added a tag to that topic
by hand before merging. The plan at merge was still "update
`aws_sns_topic.alerts`", so the fingerprints matched and the apply silently
reverted the hand edit. An emergency fix made in the console is undone by any
unrelated PR that happens to update the same resource. 0024 only caught drift
on a resource the PR did not already change.

## Decision

Everything in 0024 stands except the scope of the fingerprint, which is now
as below. In full:

- A push to `main` touching a root's plan scope runs
  `.github/workflows/terraform-apply.yml`, one run at a time (concurrency
  `terraform-apply`, never cancelled). It re-plans with the state lock and
  applies that saved planfile only when `infra/scripts/plan-summary.mjs check`
  passes:
  - the merged PR's last plan comment for that root carries a fingerprint;
  - that comment was made for the PR's final commit;
  - its fingerprint equals the new plan's;
  - the plan does not touch the apply role;
  - **the value check below passes, once it is enforced.**
  Otherwise the workflow applies nothing and posts the reason on the PR.
- **The fingerprint** is a sha256 over the sorted `(address, actions)` list of
  every change plus each resource's `source_code_hash`. It is unchanged: the
  address and actions refusal behaves exactly as under 0024, and the value
  check runs after it. A root may name attributes its PR-plan credentials
  cannot read (`unreadable` in `ROOTS`): an update touching only those counts
  as no change, and the fingerprint adds a sha256 of each such attribute's
  configured value. Only `envs/github` declares one, the rulesets'
  `bypass_actors`.
- **The value fingerprint** is, for each created, updated or replaced
  resource, an HMAC-SHA256 truncated to 16 hex, keyed by the repository secret
  `PLAN_FINGERPRINT_KEY`, over the canonical JSON of its address and planned
  `after` values. Anything `after_sensitive` marks and anything `after_unknown`
  marks is removed first. The comment carries only the
  `address → HMAC` map, in a `plan-values` HTML comment. No key (a fork's or
  Dependabot's run, or the secret unset) means no value fingerprint: it is
  never computed unkeyed, and `check` treats a missing side as "cannot compare".
  Values are never printed or logged; a mismatch names the addresses.
- **Report, then enforce.** The repository variable `PLAN_VALUE_CHECK`, set in
  `infra/terraform/envs/github/variables.tf`, is `report` or `enforce`; any
  other value counts as `report`. In `report`, a mismatch (or a comparison
  that cannot run) is written to the job summary and to the apply's comment
  on the merged PR, and the apply goes ahead. In `enforce`, a mismatch, a run
  without the key, or a PR comment without value fingerprints refuses. It
  fails closed in `enforce` only.
- **It becomes `enforce`** after four weeks of real PR plans in which every
  mismatch reported was a real hand change or a race, none a resource whose
  planned values differ between the PR's plan and the apply's for no reason
  (a computed attribute that moves with time, a provider that reads
  differently as the plan and apply identities). A spurious one is fixed by
  stripping that attribute for its resource type, and restarts the four
  weeks. Flipping the variable is a reviewed PR.
- The rest of 0024 as it was. The plan comment leads with counts and every
  delete, replace and forget address; a truncated comment keeps that header
  and the end of the plan text, and one whose header alone won't fit carries
  no fingerprint. `plan-prod` is a required check and a PR must be up to
  date with `main` (`infra/terraform/envs/github/rulesets.tf`); the plan runs
  on every PR and passes without planning when nothing in the root's scope
  changed. The scope is `infra/terraform/envs/prod/`, `modules/`, `templates/` and
  `infra/lambda/` for prod (`bootstrap` and `envs/local` are separate roots)
  and `infra/terraform/envs/github/` for GitHub, plus the pipeline itself for both. The apply
  runs as `logjam-github-actions-apply-role`
  (`infra/terraform/envs/prod/iam_apply.tf`), which trusts only the `prod`
  Environment, with `AdministratorAccess` under the permission boundary
  `logjam-github-actions-apply-boundary` that denies `rds-db:connect`, edits to
  the role or the boundary, `sts:AssumeRole`, minting IAM user credentials and
  every Deny in `local.ci_readonly_privacy_deny`. Only the maintainer applies
  that role's own changes, from their machine; `plan-summary.mjs` flags any
  address matching `.github_actions_apply` and the workflow refuses it.
  `.github/workflows/terraform-drift.yml` plans `main` nightly with
  `-detailed-exitcode`, and exit 2 opens or updates one issue.
- **Update 2026-10-03: `PLAN_FINGERPRINT_KEY` is an Environment secret.** The
  PR's plan jobs now run in the `terraform-plan` Environment
  ([0027](0027-pr-plans-run-after-the-maintainer-approves.md)), so the reason
  the key was a repository secret, and the reason "An Environment secret" is
  rejected below, no longer hold. It is a secret of `terraform-plan` (the PR
  plans) and of `prod` (the apply), the same value in both, and never a
  repository secret: `terraform-plan.yml`'s `scope` job fails if it is one.
  Only a run the maintainer approved can read it, so the Negative
  consequence that anyone who can push a branch reaches it no longer applies.
  A rotation still invalidates open PRs' comments. Everything else above stands.

Guard: `infra/scripts/plan-summary.test.mjs`, run in
`.github/workflows/terraform-ci.yml`. Beside 0024's checks it covers: a
changed value on an updated resource changes its HMAC; a sensitive value, or
one unknown until apply, does not; a different key gives a different HMAC and
no key gives none; report mode never refuses; enforce refuses on a mismatch
and when the values cannot be compared. Each test names the mutation that
turns it red.

## Consequences

- **Positive:** a hand edit to a resource the PR also changes is seen, and
  once enforced, refused, so an unrelated PR no longer silently reverts an
  emergency fix.
- **Negative:** `PLAN_FINGERPRINT_KEY` is a repository secret, not an
  Environment one: the PR's plan job has no Environment (a `prod` one deploys
  from `main` only), so anyone who can push a branch here can have a workflow
  read it, as with the plan App's key ([0025](0025-github-settings-in-terraform.md)).
  That person could then brute-force the posted HMACs of low-entropy values.
  They already read the repository, and the posted values are the PR's own
  planned values. A rotated key invalidates open PRs' comments, so rotate
  between merges. Planned values that move between the PR's plan and the
  apply's for a legitimate reason make an enforced check refuse good
  applies, which is why it reports first. An `enforce` apply refuses any PR
  planned before the key existed.
- **Neutral:** the key is set by hand and Terraform manages only the variable
  (`infra/AGENTS.md`). Value fingerprints leak nothing beyond "this
  resource's planned values changed", which the plan text already shows.
  Everything else in 0024's Consequences stands: the near-admin apply role,
  the rebase after each merge, a refused apply leaving `main` ahead of AWS, and
  `iam_apply.tf` staying a maintainer-only apply.

## Alternatives considered

- **Keep 0024's address-and-actions fingerprint.** Rejected: the drill shows
  it lets the apply revert a hand edit on a resource the PR updates.
- **A plain sha256 of the planned values.** Rejected for 0024's reason: a hash
  of a low-entropy value in a public comment can be brute-forced. The HMAC key
  held only in a secret removes that, and sensitive values are left out
  regardless.
- **Compare planned values by posting them, redacted.** Rejected: redaction
  by key name misses what the provider does not mark sensitive, and the
  comment is public.
- **Enforce from the first merge.** Rejected: this is the guard on prod
  applies, and a spurious mismatch would block every apply. Nothing yet shows
  how stable planned values are across a PR's plan and its apply.
- **An Environment secret.** Rejected: the PR's plan job could not read it
  without an Environment, and `prod` is deployable from `main` only.
