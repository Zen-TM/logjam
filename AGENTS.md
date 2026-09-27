# Logjam

Logjam is a private mapping and logbook tool for canyoning in NSW: Logjam Web
(`frontend/`) and Logjam GPS (`mobile/`) on one API (`api/`), with logic both
clients share in `shared/` and a LiDAR topo pipeline in `topo/`. Users record
places that are often deliberately unpublished, so it is not a publication
platform: privacy constrains every feature. Each package has its own
`AGENTS.md`; the reasoning behind a rule is an ADR in `docs/decisions/`.

## Privacy

- No unauthenticated endpoint serves user data, and no analytics or telemetry
  leaves the user's account.
- Sharing is explicit, per place, between signed-in users; no default widens
  who sees something. `api/AGENTS.md` has what a sharee may see.
- Logs and error reports never carry a place's coordinates, name, tags, field
  values or field labels in plain text. Guards: `api/src/lib/logger.unit.test.ts`,
  `mobile/src/sentry/scrubEvent.test.ts`.

## Environments

- **Local dev** is `make dev` with `.env.local`: fake auth as the seeded user
  alice, Postgres in docker, MiniStack for S3 and ECS. `AUTH_MODE=fake` refuses
  to start in a prod runtime (`api/src/middleware/auth.ts`); keep it that way.
- **Prod** is real AWS (`ap-southeast-2`) with Cognito; `api/.env` is
  prod-style. Never run a command that reaches prod without the maintainer's
  explicit confirmation.

## How we work

- Branch from `origin/main` in a new worktree, never from the current checkout.
- A non-trivial feature, schema migration or convention change needs an issue
  or the maintainer's sign-off on the approach; the PR says which. Small fixes
  land directly.
- Logic both clients need lives in `shared/`, with a parity test; look for it
  there before writing it in a client. [0022](docs/decisions/0022-share-the-decision-not-the-drawing.md)
- User copy names the surface, **Logjam Web** or **Logjam GPS**, never "the
  app" or "the web app" where either could be meant.
- Committed files are setup-neutral: no personal machine, host, alias or path.
  Those go in `CLAUDE.local.md`, a `*.local` skill or `.git/info/exclude`.
- Human-facing docs are written for a reader new to the repo.

## Decisions

An ADR in `docs/decisions/` keeps the reasoning for a choice someone could
later undo without knowing why. Never write one unasked; offer one, once,
when a change does all three:

- chooses between real alternatives, and the rejected one would still look
  reasonable to the next contributor;
- binds later work or is costly to reverse: a schema, wire or file format, a
  privacy or security boundary, infrastructure, a dependency floor;
- leaves the reason invisible in the code and its tests.

A bug fix, a refactor, or work that follows an existing ADR never qualifies.
Changing an accepted ADR takes a new one that supersedes it
(`docs/decisions/README.md`).

## Comments

A comment says what the code cannot: why this, why not the obvious
alternative, what broke last time. If a rename would make it redundant,
rename instead.

- Cite only what a reader of the repo can open: no audit codes (`SEC-001`),
  private plans, chat or session links. Say what the code guards instead.
- A critical invariant gets a test, and the comment cites the test.

## Testing

Each package's `AGENTS.md` says how its suites run.

- A behaviour-changing PR touches a test or says why not. A bug fix starts
  with the failing test.
- A change to a privacy or security boundary (share visibility, email
  omission, log redaction, the error-detail whitelist, auth fail-closed) ships
  a test that the boundary holds.
- A new guard test names the mutation that turns it red.
- A rule that must hold gets an executable check; two lists that must agree
  become one declaration plus a test.
