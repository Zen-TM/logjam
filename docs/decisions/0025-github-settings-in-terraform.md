# 0025. The repository's GitHub settings are Terraform, applied on merge like prod

- **Date:** 2026-09-29
- **Status:** Accepted
- **Supersedes:** —

## Context

The settings the security model stands on live in GitHub, not AWS: the
rulesets on `main` (who may merge, required checks including `plan-prod`,
squash only; updated 2026-10-01), the release rulesets, the `prod`
Environment that both AWS CI roles trust (`infra/terraform/envs/prod/iam.tf`,
`iam_apply.tf`), the squash commit message that carries DCO sign-offs onto
main ([0021](0021-agpl-and-dco.md)), Actions variables and issue labels.

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
- **Update 2026-10-01: the plan App cannot see bypass actors.** GitHub returns
  a ruleset's `bypass_actors` only to a token that may edit the ruleset. The
  plan App's plans therefore show every bypass actor as being added, and the
  apply App's show nothing, so #143's first apply refused. The comparison now
  leaves `bypass_actors` out when deciding a ruleset's action and hashes the
  configured value instead ([0024](0024-prod-terraform-applies-on-merge-by-plan-fingerprint.md)'s
  update of the same date). The PR comment says which updates it counted as no
  change; a bypass-actor change is reviewed in the code diff and the guard
  test, not in the plan text. The nightly `envs/github` drift plan runs as the
  apply App in the `prod` Environment, with the AWS apply role for its state
  and `-lock=false`, so a bypass actor added by hand shows as drift.
  Everything else above stands.
- **Update 2026-10-01: who can merge.** Two rulesets guard `main`. The
  `main` ruleset has no bypass actors: every change arrives by PR,
  squash-merged, up to date and green on the required checks (`plan-github`
  among them now), and `main` is never deleted or force-pushed. The
  `main-review` ruleset requires a code owner's approval, dismissed by a later
  push, and repository admins may bypass it. There is no `update` rule. So a
  collaborator's PR merges once the maintainer approves it and it is green;
  the maintainer's own PRs, which GitHub never lets them approve, bypass only
  the approval; and nobody merges red. The cost: anyone with write access can
  merge a PR the maintainer has approved. Everything else above stands.

Guards: `infra/terraform/envs/github/tests/guards.tftest.hcl` (run by
`terraform-ci.yml`'s `test-github`, offline against a mocked provider)
fails a change that gives the `main` ruleset a bypass actor or drops any of
its rules, required checks, up-to-date branches or squash-only merging,
removes code-owner approval or dismiss-stale from `main-review`, disables
or retargets either ruleset (updated 2026-10-01), lets `prod` deploy from
anything but `main`, opens the release rulesets or Environment, or changes
the squash message from `COMMIT_MESSAGES`. `infra/scripts/plan-summary.test.mjs`
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

- **Give the plan App Administration: write so it sees bypass actors**
  (rejected 2026-10-01). Its key is reachable by anyone who can push a
  branch, who could then edit the rulesets that protect `main`.
- **Stop managing `bypass_actors` (`ignore_changes`)** (rejected 2026-10-01).
  Terraform could then never remove a bypass actor, which is what the
  rulesets' design depends on.
- **One `main` ruleset with an `update` rule and an admin bypass** (the
  design until 2026-10-01). Only the maintainer could merge at all, but a
  bypass skips every rule of its ruleset, so every merge, even of an
  approved PR, was a bypass that also skipped the required checks. Nothing
  stopped a red merge, and the maintainer's own PRs, which they can never
  approve, had no other way in.

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
