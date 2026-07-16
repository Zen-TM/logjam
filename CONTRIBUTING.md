# Contributing to Logjam

Thanks for your interest in Logjam.

## Status of this project

Logjam is primarily a **personal project** and a portfolio piece, developed and
maintained by a single author. It is open source so others can read, learn from,
and self-host it — not because it is run as a community project.

Practically, that means:

- **Issues and pull requests may not be reviewed or responded to promptly**, if
  at all. There is no SLA, and no commitment to accept contributions.
- **Direction is set by the maintainer.** Features and design decisions follow
  the project's goals (see `README.md` and `CLAUDE.md`), not feature requests.
- Please **open an issue to discuss before** investing time in a non-trivial PR.
  A change you spent days on may still be declined if it doesn't fit the project.

If that's understood, contributions are welcome and appreciated.

## License of contributions

Logjam is licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0) — see [`LICENSE`](LICENSE). By submitting a contribution you agree it
is licensed under the same terms. In particular, AGPL-3.0 requires that anyone
running a modified version as a network service make their source available.

## Privacy is a hard constraint, not a feature

Logjam exists to **avoid** publicising sensitive wilderness canyon locations
(see the NSW NPWS guidance quoted in `README.md`). Any contribution must respect
the privacy rules enforced throughout the codebase:

- No public or unauthenticated endpoints exposing user data.
- No analytics or telemetry that leaves a user's account.
- No share/export defaults that broaden visibility — sharing is explicit,
  per-canyon, between authenticated users.
- Logs and errors must never contain canyon coordinates or names in plain text.

PRs that weaken these will not be accepted. See `CLAUDE.md` and `api/CLAUDE.md`
for the canonical access-control and logging patterns.

## Development setup

See `README.md` for full setup. In brief:

```bash
make dev      # local Postgres + MiniStack + API + frontend (AUTH_MODE=fake)
make reset    # rebuild shared, reseed, restart
```

Stack-specific rules live in the per-package guides: `frontend/CLAUDE.md`,
`api/CLAUDE.md`, `topo/CLAUDE.md`, and the root `CLAUDE.md`.

## Before opening a PR

- Keep changes focused; one concern per PR.
- Match existing conventions (the `CLAUDE.md` files document them).
- CI runs automatically on every PR (`.github/workflows/ci.yml`): unit tests,
  lint, and typecheck for all four packages. PRs must be green to merge.
- Run the same checks locally first:
  - `cd shared && npm test`
  - `cd api && npm run test:unit`
  - `cd frontend && npm test && npm run lint`
  - `cd api && npm test` (integration — needs `make dev` running; **not** run
    in CI, so don't skip it for API changes)
- PRs touching `infra/terraform/**` also get `fmt`/`validate` checks and a
  read-only `terraform plan` posted as a PR comment. Applies are manual,
  maintainer-only.
- Don't commit secrets, real user data, or `.env*` files.

## Security

If you find a security or privacy vulnerability, **do not open a public issue.**
Report it privately to the maintainer so it can be fixed before disclosure.
