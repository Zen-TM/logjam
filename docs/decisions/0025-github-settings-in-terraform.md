# 0025. The repository's GitHub settings are Terraform, applied on merge like prod

- **Date:** 2026-09-29
- **Status:** Accepted
- **Supersedes:** —

## Context

The settings the security model stands on live in GitHub, not AWS: the `main`
ruleset (admin-only merges, required checks including `plan-prod`, squash
only), the release rulesets, the `prod` Environment that both AWS CI roles
trust (`infra/terraform/envs/prod/iam.tf`, `iam_apply.tf`), the squash commit
message that carries DCO sign-offs onto main
([0021](0021-agpl-and-dco.md)), Actions variables and issue labels.

Until this change they were declared in `scripts/github-settings.sh`, which
the maintainer ran by hand with `--apply` after merging. Its dry run printed
request bodies, not a diff; nothing compared GitHub with the script, so a
setting changed in the UI stayed changed; and each merge left the settings
behind main until someone remembered to run it (#128 and #129 both ended in
"run `--apply` after merging"). Prod AWS had the same problems until
[0024](0024-prod-terraform-applies-on-merge-by-plan-fingerprint.md).

## Decision

- The settings are the Terraform root `infra/terraform/envs/github`
  (provider `integrations/github`, state `github/terraform.tfstate` in the
  prod state bucket). `scripts/github-settings.sh` is gone. They go through
  0024's pipeline unchanged: a PR's `plan-github` comment carries a
  fingerprint, merging applies it in `terraform-apply.yml`'s `apply-github`
  job only if the plan at merge matches, and `terraform-drift.yml` plans it
  nightly. `plan-github` becomes a required check beside `plan-prod` once
  the root has taken the live settings over, so that first plan only
  imports.
- `infra/scripts/plan-summary.mjs` holds each root's scope (which changed
  paths put a PR in its plan), marker and refusal text. The plan and apply
  workflows both ask `plan-summary.mjs scope`, so a root is applied for
  exactly the PRs it was planned for, and a root's apply reads only its own
  comment.
- Two GitHub Apps, mirroring the AWS plan and apply roles. The **plan App**
  has read access to Administration, Environments, Variables and Issues, and
  Contents: write (below); its key is the repository secret
  `SETTINGS_PLAN_APP_KEY`. The **apply App** adds write on Administration,
  Environments, Variables and Issues; its key `SETTINGS_APPLY_APP_KEY` is a
  secret of the `prod` Environment, so only a job on main can mint a token.
  Their client IDs are the repository variables
  `SETTINGS_PLAN_APP_CLIENT_ID` and `SETTINGS_APPLY_APP_CLIENT_ID`.
- Both Apps have Contents: write, because GitHub returns the merge settings
  (`allow_*_merge`, `squash_merge_commit_*`) only to a token with it. With a
  read-only plan App, every PR plan would show a change the apply's plan
  does not, and every apply would refuse.
- Every repository, ruleset and Environment resource has `prevent_destroy`,
  and the repository `archive_on_destroy`.
- Set by hand, outside Terraform: secret values, the two Apps and their
  keys and client IDs, and private vulnerability reporting (the provider has
  no resource for it).

Guards: `infra/terraform/envs/github/tests/guards.tftest.hcl` (run by
`terraform-ci.yml`'s `test-github`, offline against a mocked provider)
fails a change that drops the admin bypass or the update, deletion or
force-push rules on `main`, removes `plan-prod` from the required checks or
turns off up-to-date branches, lets `prod` deploy from anything but `main`,
opens the release rulesets or Environment, or changes the squash message
from `COMMIT_MESSAGES`. `infra/scripts/plan-summary.test.mjs`
covers the per-root scope and that one root's comment never passes another's
check.

## Consequences

- **Positive:** a settings change is reviewed as a diff and applied within
  minutes of merge; a hand change shows up as a refused apply or a drift
  issue. The settings that decide who can merge, release and reach AWS admin
  are guarded by a test instead of by reading a shell script.
- **Negative:** the apply App can change who can deploy to `prod`, and so who
  can assume the AWS roles: a merged change to `environments.tf` is AWS admin.
  The guard test and review are what stop it. The plan App's key is reachable
  by anyone who can push a branch here; it grants them nothing they lack
  (read on settings, and Contents: write, which pushing already implies, with
  `main` and release tags still ruleset-protected), but it is a long-lived key
  to rotate if a collaborator leaves. The `apply-github` job assumes the AWS
  apply role only to write its state, which is more AWS access than that job
  needs. Deployment-policy IDs are invisible to Terraform before import, so
  the first import needed them looked up by hand.
- **Neutral:** Dependabot PRs get no Actions secrets, so one that touches
  `envs/github` fails `plan-github` until the maintainer pushes the branch or
  adds the plan App's key as a Dependabot secret.

## Alternatives considered

- **Run `scripts/github-settings.sh --apply` from a workflow on merge.** The
  obvious step from where it was, but the script has no plan: the PR would
  show request bodies, not what changes, nothing would detect drift, and the
  fingerprint, refusal and drift machinery of 0024 would have to be rebuilt
  in bash.
- **Manage the settings in `envs/prod`.** One root and one comment, but the
  AWS apply job would then hold a GitHub admin token and the GitHub apply an
  AWS admin role for every change, and a failure in either target would block
  the other.
- **One GitHub App with a downscoped token for plans.** The key itself grants
  everything the App has, and a plan job on any PR can read it, so any
  collaborator could mint an admin token. Two Apps keep the admin key where
  only main reaches it, as the AWS roles do.
- **A personal access token instead of Apps.** It acts as the maintainer
  themselves, so CI's changes are indistinguishable from theirs in the audit
  log, and it is tied to one person's account rather than to the repository.
