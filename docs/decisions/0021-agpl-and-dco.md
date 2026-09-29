# 0021. AGPL-3.0 only; DCO sign-off, not a CLA

- **Date:** 2026-09-25
- **Status:** Accepted
- **Supersedes:** —

## Context

The repository is public under AGPL-3.0 (`LICENSE`) and is recruiting
contributors, so the terms a contribution is made under had to be settled.

## Decision

- **AGPL-3.0 only forever.** The project is licensed under AGPL-3.0 only.
- **DCO (Developer Certificate of Origin), not a CLA.**
- **Automated sign-off:** Sign-off is appended automatically by a
  `prepare-commit-msg` hook installed with the repo's hooks (least friction; the
  contributor agrees to the DCO once, in `CONTRIBUTING.md`), and a CI check
  rejects unsigned commits.
- Built (updated 2026-09-29; planned when this was written): the hook is
  `scripts/dco-signoff.sh`, run by the `prepare-commit-msg` entry in
  `package.json`, and the check is `.github/workflows/dco.yml`.
- **Update 2026-09-29: Dependabot is exempt.** The check skips a commit only
  when the pull request was opened by `dependabot[bot]` and the commit's author
  is Dependabot. A bot cannot certify the DCO, and the maintainer who reviews
  and merges the update does. A person's commit on a Dependabot branch is still
  checked. The check is `scripts/dco-check.sh`; its `--self-test`, run by the
  DCO workflow, is the guard. Everything else above stands.

## Consequences

- **Positive:** Least friction for contributors; sign-off is automated via
  `prepare-commit-msg`.
- **Negative:** Not recorded.
- **Neutral:** Contributors must agree to the DCO once in `CONTRIBUTING.md`, and
  every commit must carry a DCO sign-off.

## Alternatives considered

- Contributor License Agreement (CLA): rejected in favour of DCO; DCO chosen,
  with AGPL-3.0 recorded in an ADR.
- Accepting Dependabot's own `Signed-off-by: dependabot[bot] <support@github.com>`
  trailer (2026-09-29 update): rejected. It certifies nothing, and matching it
  would mean loosening the author-email rule for one address, which is the same
  exemption with less honesty about it.
