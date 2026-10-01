# 0024. Prod Terraform applies on merge, and only the plan the PR showed

- **Date:** 2026-09-28
- **Status:** Accepted
- **Supersedes:** —

## Context

Until this change, `infra/terraform/envs/prod` was applied by hand from the
maintainer's machine after reading the PR's plan comment
(`.github/workflows/terraform-plan.yml`). Nothing tied the apply to that plan.
Main could move after the plan ran, AWS could be changed by hand, or the
Cognito email Lambda (`infra/lambda/cognito-email-sender`) could be rebuilt
differently on the laptop, and the apply would still go ahead. A merged
change also stayed unapplied until someone remembered to apply it. Before a
contributor gets write access, merging has to be the gate, and "the plan I
read is the plan that applies" has to hold without anyone checking by hand.

The repo is public: PR comments, workflow logs and artifacts can all be read
by anyone. `terraform show -json` prints sensitive values in clear.

## Decision

- A push to `main` touching `infra/terraform/**` or `infra/lambda/**` runs
  `.github/workflows/terraform-apply.yml`, one run at a time (concurrency
  `terraform-apply`, never cancelled). It re-plans with the state lock and
  applies that saved planfile only when `infra/scripts/plan-summary.mjs check`
  passes:
  - the merged PR's last plan comment carries a fingerprint;
  - that comment was made for the PR's final commit;
  - its fingerprint equals the new plan's;
  - the plan does not touch the apply role.
  Otherwise the workflow applies nothing and posts the reason on the PR.
- The fingerprint is a sha256 over the sorted `(address, actions)` list of
  every change, plus each resource's `source_code_hash`. It covers no other
  attribute values. The plan, apply and drift jobs build the Lambda the same
  way, so a build that differs from the PR's refuses.
- The plan comment leads with counts and every delete, replace and forget
  address. A truncated comment keeps that header and the end of the plan
  text. If the header alone won't fit, the comment carries no fingerprint.
- `plan-prod` is a required check, and a PR must be up to date with `main` to
  merge (`infra/terraform/envs/github/rulesets.tf`). The plan runs on every PR and passes
  without planning when nothing under `infra/terraform/` or `infra/lambda/`
  changed.
- The apply runs as `logjam-github-actions-apply-role`
  (`infra/terraform/envs/prod/iam_apply.tf`), which trusts only the `prod`
  Environment. It has `AdministratorAccess` under the permission boundary
  `logjam-github-actions-apply-boundary`, which denies:
  - `rds-db:connect`;
  - edits to the role or to the boundary;
  - `sts:AssumeRole`;
  - minting IAM user credentials;
  - every Deny in `local.ci_readonly_privacy_deny` (user-data and audit
    objects, secret values, the Cognito CMK, RDS log events).
- Only the maintainer applies the role's first version and every later change
  to it, from their own machine. These are the only laptop applies. The
  boundary stops the role editing itself, so
  `plan-summary.mjs` flags any address matching `.github_actions_apply` and
  the workflow refuses such a plan before it starts.
- `.github/workflows/terraform-drift.yml` plans `main` nightly with
  `-detailed-exitcode`, and exit 2 opens or updates one issue.

Guard: `infra/scripts/plan-summary.test.mjs`, run in
`.github/workflows/terraform-ci.yml`. It checks that a delete cut from the
plan text still appears in the header, that fingerprints ignore order and
change with actions or with the Lambda build, and that `check` refuses stale,
missing and apply-role plans.

- **Update 2026-09-30: the scope is the prod root and what it reads.** The
  apply's path filter and the plan's scope check are `infra/terraform/envs/prod/`,
  `modules/`, `templates/` and `infra/lambda/`, not all of `infra/terraform/`.
  `bootstrap` and `envs/local` are separate roots that `envs/prod` does not
  read, so a change there cannot alter the prod plan, and a Dependabot bump of
  their providers no longer needs the AWS secrets that Dependabot runs lack.
  Everything else above stands.
- **Update 2026-10-01: attributes the plan cannot read.** A root may declare
  attributes its PR-plan credentials cannot read (`unreadable` in
  `ROOTS` in `infra/scripts/plan-summary.mjs`). For those resource types, an
  update that changes nothing else counts as no change, and the fingerprint
  adds a sha256 of each such attribute's configured value instead, which both
  plans read from the same code. Only `envs/github` declares one, the
  rulesets' `bypass_actors` ([0025](0025-github-settings-in-terraform.md));
  `envs/prod` fingerprints are computed exactly as before. Guard:
  `plan-summary.test.mjs` checks that the plan and apply views of a ruleset
  agree, that a configured change still changes the fingerprint, and that a
  real change beside the hidden one stays an update. Everything else above
  stands.

## Consequences

- **Positive:** a merged infra change is applied within minutes, exactly as
  reviewed. AWS changed by hand shows up as a refused apply or a drift issue
  instead of being silently reverted. Prod credentials no longer come from a
  laptop for routine applies.
- **Negative:** the apply role is near-admin. The boundary blocks direct
  reads and self-edits, but not indirect routes: editing another role this
  root manages and running a task as it, passing a role to a new Lambda, or
  rewriting a bucket policy. Those arrive only as merged code or a
  compromised pinned action. The deploy role trusts the same `environment:prod`
  subject, so a deploy workflow on `main` could assume the apply role. Every
  PR must be rebased after each merge to `main`. A refused apply leaves `main`
  ahead of AWS until someone re-runs it (after undoing a hand change) or merges
  a new infra PR, whose plan shows the whole diff.
- **Neutral:** changes to `iam_apply.tf` stay a manual, maintainer-only
  apply. Separating the deploy and apply subjects would need GitHub's OIDC
  `sub` customization (for example adding `job_workflow_ref`), which changes
  every role's trust at once. That is left for later.

## Alternatives considered

- **Upload the PR's saved planfile and apply it on merge.** It proves the
  same plan applies, but a planfile carries sensitive values, and artifacts
  on a public repo are public. Terraform also rejects a planfile whose state
  moved, so after any other apply it would fail anyway.
- **Keep applying from the maintainer's machine.** The apply was not tied to
  the reviewed plan, merged changes waited on memory, and long-lived admin
  credentials stayed on a laptop.
- **Fingerprint the full planned values.** It would catch a changed value
  that keeps the same action. But plan JSON holds secrets in clear, and a
  hash of a low-entropy value posted publicly can be brute-forced. Actions,
  addresses and code hashes are enough to tell the reviewed plan from another.
- **A separate `prod-infra` Environment for the apply role** (the playbook's
  first design). Any workflow on `main` can name any Environment, so this
  separates nothing unless the Environment requires reviewers, and that would
  put a second approval after the merge.
- **A hand-listed allow policy instead of admin plus a boundary.** Every new
  resource type would break the apply with AccessDenied part-way through, for
  the same reason the plan role uses `ReadOnlyAccess` plus a Deny
  (`infra/terraform/envs/prod/iam.tf`).
