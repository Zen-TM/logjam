# 0046. OTA hotfixes publish from CI when a labelled PR merges, signed by a key only main's workflows can read

- **Date:** 2026-11-07
- **Status:** Accepted
- **Supersedes:** [0009](0009-signed-ota-updates.md)

## Context

[0009](0009-signed-ota-updates.md) made Logjam GPS's OTA updates code-signed,
with the private key in `keys/`, a gitignored directory of `mobile/`, on the
machine that publishes. [0023](0023-ota-runtime-is-the-native-fingerprint.md) says a
production update comes only from `release/mobile-vX.Y.Z`, carries the one
fix, and matches the build's runtime version;
`mobile/scripts/check-production-update.js` enforces that at publish.

Releases are automated by tag (`.github/workflows/deploy-mobile.yml`).
Hotfixes were not: `docs/operations/mobile-release.md` had the maintainer cut
the release branch, cherry-pick, restore the gitignored files, run `npm ci` in
two packages, compare runtime versions by hand, then publish to `preview` and
promote to `production`. Those manual steps are the ones that go wrong (a
`node_modules` out of step with the lockfile changes the fingerprint; a dirty
tree is bundled), and they run while a released build is crashing or losing
data. Automating them means a workflow must sign, so the key has to be
somewhere a workflow can read: that is what changes from 0009.

## Decision

1. **OTA updates are code-signed, and the private key is never in this
   repo.** `mobile/certs/certificate.pem` is committed and embedded in every
   build. The key is `OTA_PRIVATE_KEY` in the `mobile-ota` GitHub Environment,
   which admits workflows on `main` only, and a backup kept with the
   keystore, which the manual lane (`docs/operations/mobile-release.md`)
   restores to that gitignored `keys/`. Every publish goes through
   `npm run update:preview` / `update:production` / `promote:production`,
   which pass `--private-key-path keys/private-key.pem`: eas-cli's default is
   `private-key.pem` beside the certificate, in a committed directory.
   Guard: the `ota_updates_are_signed_on_main_only` run in
   `infra/terraform/envs/github/tests/guards.tftest.hcl`.
2. **A hotfix is a PR to `main` labelled `ota-hotfix`.** The label is the
   decision that the fix is worth one. `.github/workflows/ota-plan.yml` holds
   no secrets: it applies the PR's diff to `release/mobile-vX.Y.Z` of the
   newest release tag (the tag itself when the branch doesn't exist yet) and
   refuses, in `mobile/scripts/ota-hotfix.js`, when there is no release tag,
   the PR also changes `api/` (which deploys on the same merge), it changes
   nothing under `mobile/` or `shared/`, it conflicts or is already there, or
   the native fingerprint moves. It then runs Logjam GPS's lint, typecheck,
   unit tests and the emulator smoke on the patched tree. Guard:
   `mobile/src/otaHotfix.test.ts`.
3. **The merge publishes, from `main`.** `.github/workflows/ota-hotfix.yml`
   acts only when the repository owner both merged the PR and started the run
   (a re-run by anyone else is refused), and the `ota-plan` run GitHub Actions
   started last on the PR's head, skipped runs aside, finished and passed:
   one still running refuses. It re-runs the plan's refusals on
   the release branch as it is then, cherry-picks the squash commit,
   publishes it to `preview`, promotes that group to `production` (rule 3 of
   0023 still runs there) and pushes the branch. `ota-rollback.yml` undoes an
   update with the same key, for the owner alone. Guard: the gate tests in
   `mobile/src/otaHotfix.test.ts`, which also check both workflows call
   `ota-hotfix.js gate` first.
4. **Only admins and the deploy key in `mobile-ota` may push
   `release/mobile-v*`.** Guard: the `releases_stay_the_maintainers` run in
   `guards.tftest.hcl`.
- **Update 2026-11-12: `ota-plan` is a required check.** A labelled PR whose
  plan is red, cancelled or still running cannot merge, so a PR no longer
  reaches `main` under the label with nothing published; taking the label off
  turns the check to skipped, which passes. Two things make that true. The
  plan runs on every event while the label is on, a change of labels included
  (it used to skip there), so a skipped run means only that the label is off.
  And the `ota-plan` job starts with its run and waits for the result, since
  a job that waits through `needs` has no check until the others finish and
  the ruleset would read an older run's meanwhile. Rule 3's gate still
  decides the publish, and reads the same job. Guards:
  `mobile/src/otaHotfix.test.ts`, the `main_admits_only_green_squashed_prs`
  run in `guards.tftest.hcl`, and `infra/scripts/check-required-checks.py`
  (the check reports on every pull request). Everything else above stands.

## Consequences

- **Positive:** the hotfix runs the same steps every time on a clean runner,
  and the human decision (the label) and check (review of the PR, and
  `ota-plan`) happen before the merge. Undoing an update no longer depends on
  which machine holds the key.
- **Negative:** code that runs in `mobile-ota` can sign JavaScript every
  phone of a release runs. That is the trust a merge to `main` already has
  for prod, whose AWS deploy roles trust the `prod` Environment, but a leaked
  GitHub secret now reaches phones, not only servers. The key now has two
  copies to replace on rotation, and rotating still needs a new build and
  reinstall, since the certificate is embedded at build time. Losing both
  copies means no OTA at all until a build ships a new certificate. The
  automated lane promotes to `production` straight after `preview`, without
  the manual lane's check of the update on a release candidate; the emulator
  smoke runs the dev client against a local stack, not the store build. Every
  push to a labelled PR, and every change to its labels, runs the emulator,
  up to an hour, with a second runner waiting on it (updated 2026-11-12). `EXPO_TOKEN`, which
  only `mobile-v*` tags could read, is now also readable on `main`. The
  `ota-plan` result is advisory against a PR that edits `ota-plan.yml`, since
  the check runs the PR's own workflow: its lint, tests and smoke can be made
  to pass, though the refusals that matter (the fingerprint, `api/`, a
  conflict) run again at publish from `main`. If the push fails after a
  publish, nothing stops the next hotfix from being planned on the branch
  without the first fix and taking it back off phones; the PR comment says
  to push by hand first.
- **Neutral:** GitHub's deploy-key bypass covers every deploy key of the
  repository, so no other deploy key may have write access. Before first use,
  the rollback drill on `preview` (`docs/operations/mobile-release.md`), and
  0023's question of whether `preview` and `production` builds of one commit
  share a fingerprint, both wait for the first `mobile-v*` tag.

## Alternatives considered

- **Publish on every merge to `main` that touches `mobile/` or `shared/`:**
  rejected by 0023 already. Every JavaScript-only merge would reach phones
  without qualification, the fingerprint can't see JavaScript that needs an
  API route the build's era lacks, and `x-logjam-client` would stop telling
  [0022](0022-mobile-builds-supported-three-months.md)'s support window which
  code a phone runs.
- **Publish `main` to the `preview` channel only:** release candidates of
  X.Y.Z share the release's fingerprint, so they would be updated past the
  tagged commit they exist to test, and it would replace hotfixes published to
  `preview` for checking.
- **Leave `ota-plan` advisory,** as this ADR first had it, read only by the
  publish gate: a labelled PR merged with a red or running plan reached
  `main` and published nothing, and the fix then went out by hand.
- **Publish from a run on the release branch,** dispatched by the merge job,
  so the Environment could admit `release/mobile-v*` alone: a dispatched run
  uses the workflow file as it was at the tag, so a fix to the workflow never
  reaches older branches. With only the owner's merges publishing, admitting
  `main` costs nothing.
- **A required-reviewer approval for each publish:** a second human step
  after PR review, which is already the check.
- **GitHub Actions as the bypass actor on `release/mobile-v*`,** with the
  workflow's own token: any collaborator's pull-request workflow can ask for a
  write token, and could then push the branch the next hotfix is built on
  and signed from.
- **Keep it manual:** viable while hotfixes are rare, but the manual steps are
  where it goes wrong, under pressure. It stays as the fallback.
- **The key in `certs/` behind a file-level gitignore exception** (0009): a
  file-level exception in a committed directory is one typo away from
  publishing the key in a public repo.
