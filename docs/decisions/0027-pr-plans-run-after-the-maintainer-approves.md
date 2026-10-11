# 0027. Pull-request plans run only after the maintainer approves them

- **Date:** 2026-10-03
- **Status:** Accepted
- **Supersedes:** —

## Context

`.github/workflows/terraform-plan.yml` plans `infra/terraform/envs/prod` and
`infra/terraform/envs/github` on every PR, and merging applies those plans
([0026](0026-plan-fingerprint-covers-planned-values.md),
[0025](0025-github-settings-in-terraform.md)). A plan job runs code from the
PR: the workflow file itself, the Terraform (providers, the lock file, data
sources) and the `npm ci` of `infra/lambda/cognito-email-sender`. Until this
change it did so for every PR from a branch in this repository, before anyone
had read the PR, with three credentials: the AWS plan role
(`logjam-github-actions-plan-role`, which trusted the OIDC subject
`repo:Zen-TM/logjam:pull_request`), the plan App's key
(`SETTINGS_PLAN_APP_KEY`) and `PLAN_FINGERPRINT_KEY`. Since collaborators were
given write access (0025, "who can merge"), whoever opens a PR chooses what
runs with those credentials.

## Decision

- The jobs `plan-prod` and `plan-github` run in the GitHub Environment
  `terraform-plan` (`infra/terraform/envs/github/environments.tf`), whose one
  required reviewer is the maintainer. Each run waits until the maintainer
  approves it under "Review deployments" on the PR. One approval covers both
  jobs of a run; every push starts a run that needs its own.
- The plan role trusts exactly `repo:Zen-TM/logjam:environment:terraform-plan`
  and `repo:Zen-TM/logjam:ref:refs/heads/main`, the nightly drift plan
  (`infra/terraform/envs/prod/iam.tf`). Never `pull_request`: a job that
  leaves out the Environment gets that subject.
- The plan and apply keys are Environment secrets, never repository secrets:
  `PLAN_FINGERPRINT_KEY` in `terraform-plan` and `prod` (the same value),
  `SETTINGS_PLAN_APP_KEY` in `terraform-plan`, `SETTINGS_APPLY_APP_KEY` in
  `prod`.
- A job in no Environment, `scope`, decides which roots a PR changes. A PR
  that changes neither skips both plan jobs, which a required check counts as
  passing, and needs no approval. If `scope` fails, the plan jobs still start,
  and fail.
- Approving a run approves its code. Before approving a collaborator's run,
  the maintainer reads the PR's workflows, Terraform and `infra/lambda`.

Guards: `infra/terraform/envs/prod/tests/guards.tftest.hcl` (`test-prod` in
`terraform-ci.yml`) fails if the plan role trusts any other subject.
`infra/terraform/envs/github/tests/guards.tftest.hcl` (`test-github`) fails if
`terraform-plan` loses its reviewer or gains another. The `scope` job, which
sees only repository secrets, fails if any of the three keys is one.

## Consequences

- **Positive:** the plan credentials reach only PR code the maintainer has
  approved, the maintainer's own PRs included. A PR's workflow can read only
  the repository secrets, which hold identifiers.
- **Negative:** every push to a PR that changes infra waits for the
  maintainer's click, on their own PRs too: GitHub has no exemption by
  author, and the required checks stay pending until then. The gate is only as
  good as the reading: approving an unread PR hands it the credentials. A
  Dependabot or fork PR that touches infra still fails, now after an
  approval. Each approved run adds a deployment entry to the PR's timeline.
- **Neutral:** the drift plan on `main` is unchanged, and the deploy and apply
  roles still trust `environment:prod`. A key set at repository level by hand
  is caught by the next PR's `scope` job, not before.

## Alternatives considered

- **Keep planning every PR automatically, and narrow the plan role until a
  run gains nothing from it.** A plan has to read the state and everything
  Terraform manages, so the role cannot be narrowed that far. Narrowing it is
  still worth doing as a second layer.
- **Customize the OIDC `sub` to include the actor, and trust only the
  maintainer.** No click, but the actor is whoever triggered the run: the
  maintainer pressing "Update branch" on a collaborator's PR would run that
  PR's code as the maintainer. It also changes every role's `sub` format at
  once ([0024](0024-prod-terraform-applies-on-merge-by-plan-fingerprint.md)).
- **`pull_request_target`,** which runs the base branch's workflow with
  secrets. The plan still has to run the PR's Terraform and Lambda build, so
  the same code would get the same credentials, and more secrets besides.
- **Only credential-less checks on PRs** (`terraform-ci.yml`'s fmt, validate
  and tests) **and a plan after merge.** Merging applies the plan the PR
  showed (0026), so that plan has to exist before the merge.
