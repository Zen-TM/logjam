# 0028. A contributor's AWS access is read-only, behind the CI privacy Deny and MFA

- **Date:** 2026-10-08
- **Status:** Accepted
- **Supersedes:** —

## Context

Until this change the only identities Terraform managed in the prod account
were roles: the CI plan, deploy and apply roles
(`infra/terraform/envs/prod/iam.tf`, `iam_apply.tf`) and the workloads' own.
A contributor other than the maintainer had a console user and group made by
hand, with a policy attached by hand, so no plan showed what that person
could do and no guard held it to anything.

A contributor needs to look at the account: to see why a deploy failed, or
what a Terraform plan in a PR would change. They never need to change it:
prod applies only from `terraform-apply.yml` on merge
([0026](0026-plan-fingerprint-covers-planned-values.md)). The CI plan role
already has the grant that fits, `ReadOnlyAccess` minus
`local.ci_readonly_privacy_deny`, which keeps user data, secret values, logs
and the user directory out of CI.

## Decision

- A contributor's AWS access is a console user in the group
  `logjam-developers`, declared in
  `infra/terraform/envs/prod/iam_contributor.tf`. The group holds the managed
  policy `ReadOnlyAccess` and one inline policy, both through exclusive
  resources; the user holds no policy of its own. Whatever is attached by
  hand is detached by the next apply.
- The inline policy carries every statement of
  `local.ci_readonly_privacy_deny`, so a contributor reads no more than a
  plan run does, and a statement added to that Deny binds both.
- It also denies every object in the state bucket. The plan role must read
  the state; a person reads the plan in the PR.
- Its only Allows are IAM self-service: the contributor's own password and
  MFA device. A contributor changes AWS by opening a PR.
- Everything except enrolling an MFA device is denied to a session without
  MFA.
- The user has no access key, and the policy lets them create none: access is
  through the console.
- Terraform does not manage the login profile. The maintainer sets and resets
  the password by hand.

Guard: the run `contributor_is_read_only_and_mfa_gated` in
`infra/terraform/envs/prod/tests/guards.tftest.hcl` fails on a second
attached or inline policy, a policy on the user, a missing statement of the
CI Deny, a readable state bucket, a skippable MFA gate, or an Allow outside
`iam:`. Nothing checks that the user has no access key.

## Consequences

- **Positive:** one carve-out to maintain for CI and people. The grant is in
  the repository, shows in every plan, and cannot widen without a failing
  test.
- **Negative:** a contributor cannot read application logs, which is the
  first thing wanted when a deploy misbehaves; the maintainer reads them and
  passes on what is relevant. The Deny subtracts from a policy AWS widens
  with each new service: objects and log events are closed by default, but a
  new kind of store (a table, a queue with a new read action) is readable
  until a statement denies it, and no guard notices. A lost MFA device locks
  the contributor out until the maintainer removes it by hand.
- **Neutral:** most of what the grant shows is already public in
  `infra/terraform`. What is not: the account's activity history, deploy-time
  settings Terraform ignores, object keys, and live state such as addresses
  and ids.

## Alternatives considered

- **A hand-picked list of read actions** instead of `ReadOnlyAccess` minus a
  Deny. It fails closed for new services, which the Deny does not. Rejected
  because it breaks whenever the infrastructure gains a resource type, and it
  would be a second grant to keep in step with the plan role's.
- **No MFA,** since the configuration a contributor sees is mostly public and
  hiding it protects nothing. Kept for what is not public (above) and because
  a password alone would be the weakest credential in the account, in front
  of a Deny that can lag behind AWS. The cost is one enrolment.
- **Log access for contributors.** Logs are scrubbed of place data by design
  (`api/src/lib/logger.unit.test.ts`), but the request log carries viewers'
  addresses and paths, and the CI roles are denied it for the same reason.
  Rejected as a default; a scoped exception would be a new decision.
