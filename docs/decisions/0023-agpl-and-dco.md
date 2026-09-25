# 0023. AGPL-3.0 only; DCO sign-off, not a CLA

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
- Not yet built as of 2026-09-25: the hook and the CI check are planned work.

## Consequences

- **Positive:** Least friction for contributors; sign-off is automated via
  `prepare-commit-msg`.
- **Negative:** Not recorded.
- **Neutral:** Contributors must agree to the DCO once in `CONTRIBUTING.md`, and
  every commit must carry a DCO sign-off.

## Alternatives considered

- Contributor License Agreement (CLA): rejected in favour of DCO; DCO chosen,
  with AGPL-3.0 recorded in an ADR.
