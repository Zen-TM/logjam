# Contributing to Logjam

Logjam is built and run by one maintainer and is open to contributors.
Contributions are welcome: bug fixes, docs, and features agreed in an issue
first. Bandwidth is one person's, so the schedule under
[Review and merge](#review-and-merge) is what you can count on.

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
feature proposal form. Wait for the maintainer to agree the approach in the
issue, marked by the `accepted` label, before writing code: a pull request for
a feature nobody agreed to may be closed unreviewed. Your pull request then links the issue.

**Open a pull request directly** for a typo, a docs fix, a lint or tooling
fix, or a small bug fix that starts with a failing test.

Unsure which? Open the issue. A short issue costs less than a pull request
that gets turned down.

To report a bug, use the bug form and describe it with made-up data.

## Review and merge

- New issues get a first response within a week.
- Pull requests get a first review within two weeks, and a full review as
  time allows.
- Security reports follow [`SECURITY.md`](SECURITY.md).

- Only the maintainer merges. Every pull request needs the code owner's
  approval ([`.github/CODEOWNERS`](.github/CODEOWNERS)), a new push dismisses
  an earlier approval, and write access to the repository does not let you
  merge.
- CI must be green.
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

## Setting up

Run `make setup`, then follow `docs/dev-setup.md`, which covers Linux, macOS
and Windows. On Windows, clone inside WSL2: the repo uses symlinks that a
native Windows clone breaks.

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
in [`.agents/skills/`](.agents/skills/). The skills load when their task comes
up:

- `local-testing`: running or debugging the local stack, the integration
  suite, Playwright or an Android device.
- `pr-review`: reviewing a pull request, a branch or your own changes before
  opening one.
- `writing-adrs`: writing an ADR once one is agreed.
- `csp-hosts`: adding an external host the frontend fetches from.
- `authoring-skills`: writing a skill or changing an `AGENTS.md` rule.

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
  migration checks, the mobile export, the secret scan, and the Terraform
  checks and plan.
- Keep a pull request to one concern, give it a title in Conventional Commit
  form (`fix(api): ...`), and fill in the template.
- Never commit secrets, `.env` files or real user data.
