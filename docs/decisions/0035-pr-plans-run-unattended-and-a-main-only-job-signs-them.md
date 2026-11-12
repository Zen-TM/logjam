# 0035. Pull-request plans run unattended, and a main-only job signs their comments

- **Date:** 2026-10-18
- **Status:** Accepted
- **Supersedes:** [0027](0027-pr-plans-run-after-the-maintainer-approves.md)

## Context

[0027](0027-pr-plans-run-after-the-maintainer-approves.md) made each run of
`.github/workflows/terraform-plan.yml` wait for the maintainer's approval,
because `plan-prod` and `plan-github` run the PR's own code (its workflows,
Terraform and `infra/lambda`) with three credentials. In practice that was a
click on every push to every infra PR, the maintainer's own included, and a
busy maintainer clicked without reading: 0027's own Negative, "the gate is
only as good as the reading". It also left a gap: any PR's workflow can post
a comment as `github-actions[bot]` from a job outside the Environment, with
no approval, and until #493 the apply accepted such a comment for a plan
that created, updated and replaced nothing.

What each credential gives beyond what a collaborator with write access
already has ([0032](0032-contributor-aws-access-is-read-only-behind-the-ci-deny.md)
gives them `ReadOnlyAccess` minus `local.ci_readonly_privacy_deny` in the
console):

- **The AWS plan role** (`logjam-github-actions-plan-role`,
  `infra/terraform/envs/prod/iam.tf`): the same grant, plus the state
  bucket. The state's one secret value is `random_password.origin_verify`,
  which CloudFront also returns to any read-only identity as the origin's
  `X-Origin-Verify` header. The RDS master password is RDS-managed and the
  secret versions are write-only (`secret_string_wo`), so neither is in state.
- **The plan App's key** (`SETTINGS_PLAN_APP_KEY`): nothing
  ([0025](0025-github-settings-in-terraform.md)).
- **`PLAN_FINGERPRINT_KEY`**: whoever holds it can sign a plan comment that
  the apply accepts while it describes another plan, and can brute-force the
  HMACs of low-entropy values in other comments
  ([0026](0026-plan-fingerprint-covers-planned-values.md)).

Only the key needed the approval.

## Decision

- `plan-prod` and `plan-github` run in the `terraform-plan` Environment with
  no reviewer. They hold the AWS plan role, whose trust is unchanged
  (`environment:terraform-plan` and `main`), and `SETTINGS_PLAN_APP_KEY`.
  They never hold `PLAN_FINGERPRINT_KEY`, and fail if they can read it.
- Each plan job uploads an artifact `plan-<root>`: `plan.txt.age` and, when
  the plan succeeded, `plan.json.age`, encrypted with age to
  `PLAN_TRANSFER_RECIPIENT` in `terraform-plan.yml`, kept one day. The plan
  JSON holds live values, and artifacts on a public repository are public.
- `.github/workflows/terraform-plan-sign.yml` runs on `workflow_run` of
  `terraform-plan`, so always `main`'s copy, in the Environment
  `terraform-plan-sign`, which admits `main` only and holds
  `PLAN_FINGERPRINT_KEY` and the age identity `PLAN_TRANSFER_IDENTITY`. It
  decrypts the artifact, renders and signs the comment with
  `infra/scripts/plan-summary.mjs comment`, and posts it for the run's head
  commit unless the PR has moved on. It reads the artifact as data: it never
  checks out the PR, and never uses the Actions cache, which a run on `main`
  shares with later `main` runs.
- `PLAN_FINGERPRINT_KEY` is a secret of `terraform-plan-sign` and `prod`
  only.
- The comment's summary (counts, every destroy, and every update with the
  names of the attributes it changes) is computed from the plan JSON whose
  fingerprint the apply checks. The plan text under it is the PR's run's own
  output, and the comment says so.
- No plan adds a sensitive value to the state. `stateSecrets()` in
  `plan-summary.mjs` makes the comment refuse, with no fingerprint, when a
  created, updated or replaced resource gains one, except at an address in
  its root's `stateSecrets`, each with the reason a read-only identity can
  read the value anyway. Today that is `random_password.origin_verify`.
- The merge stays the gate: the maintainer reviews each PR and its comment
  before merging, and the apply refuses any plan but the one signed
  (0026).

Guards: `plan_comments_are_signed_on_main_only` in
`infra/terraform/envs/github/tests/guards.tftest.hcl` fails if
`terraform-plan-sign` admits any ref but `main`. The plan role's trust guard
in `infra/terraform/envs/prod/tests/guards.tftest.hcl` is unchanged. The plan
jobs fail if `PLAN_FINGERPRINT_KEY` is a secret of their Environment, and the
`scope` job if it is a repository secret. `infra/scripts/plan-summary.test.mjs`
covers unsigned and edited comments, the attribute names in the summary, and
a new secret in state. Nothing checks that `ReadOnlyAccess` minus the Deny
stays within what a collaborator should read (0032's gap), or that the EB
environment's properties, which CI sets and the state holds, carry no
secret.

## Consequences

- **Positive:** no click. An infra PR's plan posts once its run and the
  signer finish, and the key that makes a comment trusted never reaches a PR's code.
  A comment can no longer be forged, and a plan text that misdescribes the
  plan sits under a summary that does not.
- **Negative:** anyone with write access can read the Terraform state and
  the plan App's view of the settings through a PR, which 0032 keeps out of
  the console; 0032's Deny lag (a new kind of store is readable until a
  statement denies it) now reaches them through CI as well. The origin-verify
  token is one of the things they read, as they already could in the
  console: rotate it, and the plan App's key, when a collaborator leaves. The
  signer HMACs whatever plan JSON a PR uploads, so it is an oracle, at one
  guess per address per push. A misleading plan text still posts; the
  reviewer reads the summary and the code diff. `PLAN_TRANSFER_IDENTITY` and
  the key are set by hand; rotating the age identity means a PR changing
  `PLAN_TRANSFER_RECIPIENT`, and rotating either key means re-planning open
  PRs. Each plan job and the signer install age from apt.
- **Neutral:** fork and Dependabot PRs fail the plan as before. The nightly
  drift plan and the apply are unchanged.

## Alternatives considered

- **Keep 0027's approval.** Rejected: the click was being given unread, and
  it never covered a comment posted from outside the Environment.
- **A main-only bot that approves the maintainer's own runs,** checking that
  every push to the branch was theirs. Rejected: the key would still reach
  the code of a collaborator's PR approved by hand, and the bot needs a
  maintainer token in CI to approve as the required reviewer.
- **Plan in the trusted workflow.** Rejected: the plan runs the PR's
  Terraform, providers and Lambda build, which would then run beside the key,
  and a `workflow_run` job on `main` shares `main`'s cache with the deploys.
- **Upload the plan unencrypted.** Rejected: artifacts on a public
  repository are public, and the plan JSON holds every changed resource's
  values, the origin-verify token among them when the distribution changes.
- **openssl instead of age.** Rejected: `openssl enc` has no authenticated
  mode, so the signer's public logs could become a padding oracle; age is
  authenticated and one command each way.
- **Replace the value HMACs with a drift check at apply time,** so the
  comment needs no key at all. Rejected for now: it changes what 0026
  compares, and the comment would still need something only trusted code
  can produce to tell it from a forged one.
