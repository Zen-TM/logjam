# Contributing to Logjam

Logjam is built and run by one maintainer and is open to contributors.
Contributions are welcome: bug fixes, docs, and features agreed in an issue
first. Bandwidth is one person's; [Review and merge](#review-and-merge) says
what to expect.

This file covers how a change gets in, what you agree to by making one, and
where the rules live.

## Privacy comes first

Logjam holds places its users have chosen not to publish, so privacy bounds
every change. The rules are in the root [`AGENTS.md`](AGENTS.md) → Privacy,
and a pull request that weakens them is not merged. In practice:

- Never put real coordinates, place names, map screenshots, GPX tracks, photos
  or field data in an issue, pull request, commit or test fixture. Use the
  seeded dev data, which is made up.
- A change to a privacy or security boundary ships a test that the boundary
  holds.
- A vulnerability goes to [`SECURITY.md`](SECURITY.md), never to an issue.

## How a change gets in

**Open an issue first** for a new feature or a change in what users see, a
schema migration, a change to the API or sync format, an architectural or
infrastructure change, or a change to a convention in an `AGENTS.md`. Use the
[feature proposal form](https://github.com/Zen-TM/logjam/issues/new?template=proposal.yml).
Wait for the maintainer to agree the approach in the issue, marked by the
`accepted` label, before writing code: a pull request for a feature nobody
agreed to may be closed unreviewed. Your pull request then links the issue.

**Open a pull request directly** for a typo, a docs fix, a lint or tooling
fix, or a small bug fix that starts with a failing test.

Unsure which? Open the issue. A short issue costs less than a pull request
that gets turned down.

To report a bug, use the
[bug report form](https://github.com/Zen-TM/logjam/issues/new?template=bug.yml)
and describe it with made-up data.

## Review and merge

Logjam is a hobby project with one maintainer, so response times vary. Most
issues get a reply within a week or two and most pull requests a first review
within a few weeks, but it can take longer when the maintainer is away.
Security reports follow [`SECURITY.md`](SECURITY.md).

- Every pull request needs the code owner's approval
  ([`.github/CODEOWNERS`](.github/CODEOWNERS)), and a new push dismisses an
  earlier approval. Once it is approved and green, anyone with write access
  may squash-merge it. The maintainer's own pull requests merge without that
  approval, since GitHub never lets an author approve their own.
- CI must be green. Nobody, the maintainer included, can merge past a failing
  required check.
- A pull request from a fork that changes `infra/terraform/` or
  `infra/lambda/` can't be planned here: GitHub gives fork pull requests none
  of the credentials the plan needs. The maintainer re-opens it from a branch
  in this repository.
- Merging ships. The API, Logjam Web and the topo worker deploy from `main`
  once CI passes, and Terraform changes are applied on merge, exactly as the
  plan comment on the pull request showed
  ([ADR 0024](docs/decisions/0024-prod-terraform-applies-on-merge-by-plan-fingerprint.md)).
  A migration must be safe to run while the previous version still serves
  ([ADR 0003](docs/decisions/0003-pre-deploy-migrations-expand-contract.md)).

## Sign-off (DCO)

Logjam is licensed under AGPL-3.0 only ([`LICENSE`](LICENSE)), and so is
every contribution. There is no CLA. Instead, each commit carries a
`Signed-off-by:` line certifying the
[Developer Certificate of Origin](https://developercertificate.org/): that
you wrote the change, or otherwise have the right to submit it under the
project's licence.

Running `npm ci` at the repository root installs the repo's git hooks, and
one of them adds the `Signed-off-by:` line to every commit from your git
`user.name` and `user.email`. **Committing with the hooks installed means you
agree to the DCO for that commit.** CI rejects a pull request with an
unsigned commit; to fix one, run `git rebase --signoff origin/main` and
force-push.

If a coding agent wrote the commit, the sign-off is yours: you read the change
and you certify it. The reasoning is in
[ADR 0021](docs/decisions/0021-agpl-and-dco.md).

Dependabot's dependency-update pull requests are the one exception: a bot
cannot certify the DCO, so CI skips commits Dependabot itself authored. The
maintainer who reviews and merges the pull request takes responsibility for it.
A commit a person adds to a Dependabot branch still needs a sign-off.

## Setting up

Follow [`docs/dev-setup.md`](docs/dev-setup.md), from a fresh clone to a
running stack on Linux, macOS or Windows (inside WSL2).

## Where the rules live

- The root [`AGENTS.md`](AGENTS.md) holds the rules for the whole repository:
  privacy, how we work, comments, testing and when a decision needs an ADR.
  Each package has its own: [`api/`](api/AGENTS.md),
  [`frontend/`](frontend/AGENTS.md), [`mobile/`](mobile/AGENTS.md),
  [`shared/`](shared/AGENTS.md), [`topo/`](topo/AGENTS.md) and
  [`infra/`](infra/AGENTS.md). They are written for people and coding agents
  alike; read the ones your change touches.
- [`docs/decisions/`](docs/decisions/README.md) holds the reasoning behind
  choices someone might otherwise undo.
- [`docs/architecture.md`](docs/architecture.md) is the map of the system.

## Coding agents

Claude Code, Codex and Antigravity all read the `AGENTS.md` files (each
`CLAUDE.md` is a one-line import of the `AGENTS.md` beside it) and the skills
in [`.agents/skills/`](.agents/skills/), which load when their task comes up.

Your own skills go in `.agents/skills/<name>.local/`, and your own notes in
`CLAUDE.local.md`; git ignores both. Keep machine names, paths and aliases
there, not in committed files.

## Before you open a pull request

- Run `make verify` (format check, lint and typecheck across the packages)
  and the unit tests of each package you changed:

  | Package | Command |
  |---|---|
  | `shared` | `cd shared && npm test` |
  | `api` | `cd api && npm run test:unit` |
  | `frontend` | `cd frontend && npm test` |
  | `mobile` | `cd mobile && npm test` |
  | `topo` | `cd topo && python -m unittest discover -s tests` |

- CI runs the rest: the API integration suite against a live stack, the
  migration checks, the mobile export, the secret scan, the Terraform checks
  and plan, and a build of the API or topo worker Docker image when a change
  touches what it is built from.
- Keep a pull request to one concern, give it a title in Conventional Commit
  form (`fix(api): ...`), and fill in the pull request template.
- Never commit secrets, `.env` files or real user data.
