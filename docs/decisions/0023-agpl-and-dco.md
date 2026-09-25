# 0023. AGPL-3.0 only; DCO sign-off, not a CLA

- **Date:** 2026-09-25
- **Status:** Accepted
- **Supersedes:** —

## Context

Contribution licensing and terms must be established for contributors without
introducing friction that discourages contributions or compromising copyleft
protections.

## Decision

- **AGPL-3.0 only forever.** The project is licensed under AGPL-3.0 only.
- **DCO (Developer Certificate of Origin), not a CLA.**
- **Automated sign-off:** Sign-off is appended automatically by a
  `prepare-commit-msg` hook installed with the repo's hooks (least friction; the
  contributor agrees to the DCO once, in `CONTRIBUTING.md`), and a CI check
  rejects unsigned commits.

## Consequences

- **Positive:** Least friction for contributors; sign-off is automated via
  `prepare-commit-msg`; strong copyleft guarantees under AGPL-3.0.
- **Negative:** Not recorded.
- **Neutral:** Contributors must agree to the DCO once in `CONTRIBUTING.md`, and
  every commit must carry a DCO sign-off.

## Alternatives considered

- Contributor License Agreement (CLA): rejected in favour of DCO; DCO chosen,
  with AGPL-3.0 recorded in an ADR.
