# Releasing Logjam GPS

Logjam Web and the API deploy on every merge to `main`. Logjam GPS does not:
a build stays on a phone until its owner updates it, possibly months later
and after a trip without signal, so a release is a deliberate act. This page
is how a build gets from `main` to phones, and what is checked first.

| Lane | Trigger | What it produces | Reaches |
|---|---|---|---|
| Release | tag `mobile-vX.Y.Z` | Play bundle, EAS `production` profile, channel `production` | Play internal track as a draft; promoted by hand |
| Release candidate | tag `mobile-vX.Y.Z-rc.N` | APK, EAS `preview` profile, channel `preview` | whoever installs the APK; nothing is submitted |
| OTA hotfix | merging a PR labelled `ota-hotfix` (by hand as a fallback) | a signed JavaScript update, from `release/mobile-vX.Y.Z` | builds of X.Y.Z on `preview` and `production` |

Both tags run `.github/workflows/deploy-mobile.yml`. It refuses a tag that
does not name `mobile/package.json`'s version, has no section in
`CHANGELOG.md`, or points at a commit on neither `main` nor a
`release/mobile-vX.Y.Z` branch, then starts the EAS build and does not wait
for it. Follow the build on expo.dev.

Only the maintainer creates `mobile-v*` tags. A build's release date, which
decides how long the API must keep supporting it
([0022](../decisions/0022-mobile-builds-supported-three-months.md)), is the
date of its release tag.

## One-time setup

Needed before the first release tag.

1. **GitHub settings:** `infra/terraform/envs/github` declares the
   `mobile-release` Environment (deployable from `mobile-v*` tags only) and
   two rulesets that let only repository admins create, move or delete
   `mobile-v*` tags and `release/mobile-v*` branches, except that the deploy
   key held in the `mobile-ota` Environment may also push those branches for
   an OTA hotfix (step 7). A tag push is a release, and the workflow accepts a
   tag on those branches, so these are the permissions that matter.
2. **`EXPO_TOKEN`**, the Environment's one secret, set by hand (Settings →
   Environments → `mobile-release`): a robot-user access token from expo.dev
   for the `logjamnsw` account, with access to the `logjam-mobile` project.
3. **Play Console app** for `com.logjamnsw.mobile`. Google accepts the first
   bundle of a new app only by hand upload, so the first release tag's
   automatic submission fails. Download that build's `.aab` from its EAS build
   page and upload it to the internal testing track yourself. Later releases
   submit on their own.
4. **Google Play service account** (Google Cloud → IAM → service account,
   JSON key; Play Console → Users and permissions → invite it with release
   permissions for this app). Upload the key to EAS, not GitHub:
   `eas credentials --platform android` → Google Service Account. EAS uses it
   for `--auto-submit`.
5. **EAS environments `preview` and `production`** carry the same variables
   (`EXPO_PUBLIC_OIDC_ISSUER`, `EXPO_PUBLIC_OIDC_CLIENT_ID`,
   `EXPO_PUBLIC_SENTRY_DSN`, `GOOGLE_SERVICES_JSON`), and should carry the
   same values: both profiles talk to the production stack
   (`mobile/eas.json`). `mobile/scripts/check-eas-env.sh` refuses a store build
   or an update when either OIDC variable is missing.
6. **Production access.** The Play developer account is a personal one, so
   Google allows production releases only after a closed test with at least
   12 testers opted in for 14 continuous days, followed by an application in
   Play Console. Until then a release goes no further than internal or closed
   testing. Check Play Console's current wording before starting the clock.

7. **The OTA hotfix lane** (before the first labelled PR merges): in
   Settings → Environments → `mobile-ota`, which
   `infra/terraform/envs/github` declares deployable from `main` only, set:
   - `EXPO_TOKEN`: a robot token as in step 2 (the same one is fine);
   - `OTA_PRIVATE_KEY`: the contents of `mobile/keys/private-key.pem`, the
     key whose certificate is `mobile/certs/certificate.pem`;
   - `RELEASE_BRANCH_DEPLOY_KEY`: the private half of a new SSH key
     (`ssh-keygen -t ed25519 -N '' -C ota-hotfix -f ota-deploy-key`). Add the
     public half under Settings → Deploy keys, with write access. The
     `mobile-release-branches` ruleset lets deploy keys push
     `release/mobile-v*`, so this must stay the repository's only deploy key
     with write access. Delete the local files once both are set.

Submissions go to the internal track as a **draft**
(`submit.production.android` in `mobile/eas.json`): a draft is accepted even
while the Play app itself is still a draft, and it means nothing reaches a
tester until you roll it out.

## Cutting a release

1. **Release PR** from a branch off `origin/main`:
   - `cd mobile && npm version X.Y.Z --no-git-tag-version` (updates
     `package.json` and `package-lock.json`; `package.json` is the one
     declaration of the version, guarded by `src/versionAgreement.test.ts`).
   - In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`
     and start a new empty `## [Unreleased]` above it.

   Pick the version by what users see: a patch for fixes only, a minor for
   anything new. The required `expo-doctor` check runs on this PR, and only on
   a PR that changes the version: if Expo has published a patch release since
   the last one, run `cd mobile && npx expo install --fix` and commit the
   result here. Merge it.
2. **Qualify** the merge commit ([below](#release-qualification)).
3. **Optional release candidate:** `git tag mobile-vX.Y.Z-rc.1 <sha>` and
   `git push origin mobile-vX.Y.Z-rc.1`. The APK installs over a `preview`
   build, not over a Play build (their signing keys differ). If it shows a
   problem, fix on `main`, and the next candidate is `-rc.2` on the new
   commit.
4. **Tag the release** on the same commit:
   `git tag -a mobile-vX.Y.Z <sha> -m "Qualified: Maestro 4/4 on <emulator|phone>"`
   and `git push origin mobile-vX.Y.Z`.
5. **Roll out on internal testing:** when EAS has submitted, Play Console →
   Testing → Internal testing → the draft release → review and roll out.
6. **Smoke-test the Play build** (required): on a real Android phone, install
   it from Play, over the previous release when there is one. It launches,
   you can sign in, and the first sync finishes. This is the only check that
   runs the store binary itself; Maestro runs the dev client.
7. **Promote** in Play Console: to the closed testing track while production
   access is pending, to production at 100% after. Both go through Google's
   review. Staged rollout is not used while the user base is small: a 10%
   slice of a few users is nobody.

A binary cannot be taken back off phones. A bad release is fixed forward: the
next release, or an OTA hotfix if the fix is JavaScript only.

## Release qualification

A release is **qualified** when every Maestro flow in `mobile/e2e/` passes in
one session, on a dev client built from the commit to be tagged (rebuild it
if native code changed since the installed one), on an Android emulator or a
real Android phone, against the local stack. Setup, and what each flow
needs: [`mobile/e2e/README.md`](../../mobile/e2e/README.md).

| Flow | Auth mode (`EXPO_PUBLIC_AUTH_MODE` in `mobile/.env`) | Covers |
|---|---|---|
| `browse.yaml` | `fake` | the signed-in shell: tabs, place list from the API, place detail, inbox, account |
| `map.yaml` | `fake` | map tab, layers picker, the vector basemap and its attribution, locate-me |
| `guest.yaml` | `oidc`, after `adb shell pm clear com.logjamnsw.mobile` | the entry chooser, a guest's local place, account features shown disabled |
| `signin.yaml` | `oidc`, with the test Cognito user | real password sign-in on the landing screen to the shell |

A flow that fails is not retried until it passes: find out why. A flow broken
by an intended UI change is fixed in a PR to `main`, and the release waits
for it. Record the result in the release tag's message (step 4).

Qualification never runs in CI: Maestro needs an Android emulator, and
GitHub-hosted runners have no reliable hardware acceleration for one.

## OTA hotfixes

The exception, not a release path. Use one only when a released build has a
JavaScript-only bug bad enough that waiting for the next release is worse: a
crash, lost or unsynced data, a broken sign-in. Everything else waits for a
release. The rules are [0023](../decisions/0023-ota-runtime-is-the-native-fingerprint.md)
and [0046](../decisions/0046-ota-hotfixes-publish-from-ci-on-a-labelled-merge.md).

A hotfix goes to the newest release, X.Y.Z (the newest `mobile-vX.Y.Z` tag),
from `release/mobile-vX.Y.Z`: a branch cut from that tag that holds only
hotfixes. Never publish from `main`: it carries everything merged since the
release, and may need API routes or native code the build lacks. The version
stays X.Y.Z: the update must match the build.

1. **Fix on `main` by PR,** and add the `ota-hotfix` label. The PR must not
   also change `api/`, which deploys on the same merge: land an API change
   first, in its own PR.
2. **Read the `ota-plan` check and its comment.** It applies the PR's diff to
   `release/mobile-vX.Y.Z` (or the tag, before the first hotfix), refuses a
   conflict or a change to the native fingerprint, and runs Logjam GPS's lint,
   typecheck, unit tests and the emulator smoke on the result
   (`.github/workflows/ota-plan.yml`, `mobile/scripts/ota-hotfix.js`). It
   runs again on each push, and each change of labels, while the label is on,
   and it is a required check: a red, running or cancelled plan stops the
   merge (re-run a cancelled one). To merge without publishing, take the
   label off. The comment says which
   version and runtime the merge would publish to, or why it can't. The smoke
   runs the release's own `mobile/scripts/emulator-smoke.sh` and
   `.github/actions/build-dev-apk` under today's `mobile-emulator.yml`: if
   those have drifted apart since the tag, the smoke fails and the hotfix goes
   by hand.
3. **Merge it yourself,** keeping the `(#N)` GitHub puts at the end of the
   squash commit's title: the workflow finds the PR by it, and without it
   publishes nothing. `.github/workflows/ota-hotfix.yml` publishes only
   when the repository owner merged (and started the run) and `ota-plan`
   passed on the PR's head. It
   cherry-picks the squash commit onto `release/mobile-vX.Y.Z`, publishes it
   to `preview`, promotes that group to `production` (through the same
   `check-production-update.js` checks as by hand), then pushes the branch.
   It comments on the PR with both group ids, or with what failed: if the
   promotion fails, the update is on `preview` only. If the comment says the
   branch was not pushed, push it by hand (By hand, step 1, with the
   cherry-pick) before anything else merges with the label: the next hotfix
   is planned on the branch as it is on GitHub, so it would lack this fix and
   take it back off phones. A hotfix merged while another publishes waits;
   a third one merged meanwhile cancels the waiting one, which comments so:
   re-run it.
4. **Watch Sentry** for the next launches. To undo, run
   `gh workflow run ota-rollback.yml -f group=<production group id>` on
   `main` (or Actions → ota-rollback). It republishes the update before it,
   or tells phones to run the JavaScript embedded in the build when there is
   none. The group must be the newest on its branch.
5. **Delete `release/mobile-vX.Y.Z`** once the next release is out. Until
   then a second hotfix for the same build starts from it.

A phone checks for an update on launch and applies it on the next launch
(`fallbackToCacheTimeout: 0`), so a fix takes two launches to take effect.

Before the first hotfix, drill the rollback on `preview` by hand: publish,
confirm a candidate build picks it up, roll back, confirm it returns to the
previous JavaScript.

### By hand

When CI can't publish (GitHub Actions is down, a secret has lapsed, or the
fix is for a release older than the newest), the same steps from the
maintainer's machine, after the fix has merged to `main`:

1. **Branch from the build's tag**, or check out `release/mobile-vX.Y.Z` if a
   hotfix already made it, and cherry-pick the fix (one commit, as PRs are
   squash-merged):

   ```sh
   git switch -c release/mobile-vX.Y.Z mobile-vX.Y.Z
   git cherry-pick -x <fix sha>
   git push origin release/mobile-vX.Y.Z
   ```

2. **Prepare the checkout:** `npm ci` in `shared/` (then `npm run build`)
   and `mobile/`; `mobile/google-services.json` and `mobile/keys/private-key.pem`
   restored (both gitignored), with `GOOGLE_SERVICES_JSON` pointing at the
   former.
3. **Check the runtime version** matches the build's:

   ```sh
   cd mobile
   npx expo-updates runtimeversion:resolve --platform android | node -p 'JSON.parse(require("fs").readFileSync(0)).runtimeVersion'
   eas build:list --platform android --limit 10 --json --non-interactive |
     node -p 'JSON.parse(require("fs").readFileSync(0)).map(b => `${b.appVersion} ${b.buildProfile} ${b.runtimeVersion}`).join("\n")'
   ```

   If they differ, stop. Either the checkout differs (another commit, or
   `node_modules` out of step with the lockfile) or the fix changed something native (a dependency,
   a plugin, `patches/`, `eas.json`, npm scripts), and it needs a release, not
   an update. Published anyway, it would reach no phone and say nothing.
   `update:production` repeats this check for the checkout, and
   `promote:production` for the update group it republishes (so it needs
   `--group`). Both also refuse a branch other than `release/mobile-vX.Y.Z` or
   one that does not descend from the tag, and `update:production` refuses
   uncommitted changes, which `eas update` would bundle.
4. **Publish to `preview` and check it** on a release candidate of X.Y.Z, if
   one exists and has the same runtime version:
   `npm run update:preview -- --message "<what it fixes>"`.
   The script passes `--environment`, so the bundle uses the EAS
   environment's variables, not `mobile/.env`, which points at the local
   stack.
5. **Promote the same update to `production`:**
   `npm run promote:production -- --group <update group id>`.
   With no candidate to check it on, publish directly instead:
   `npm run update:production -- --message "<what it fixes>"`.
6. **Undo** with `eas update:rollback <group id> --private-key-path keys/private-key.pem`.

## Backports

When a released build needs a fix that is **not** JavaScript only, and `main`
holds work that should not ship yet: branch `release/mobile-vX.Y.Z` from the
tag as in [OTA hotfixes, By hand](#by-hand), step 1, cherry-pick, bump to X.Y.(Z+1) and add its
`CHANGELOG.md` section on the branch (and the same section on `main`), then
tag `mobile-vX.Y.(Z+1)` on the branch and release as usual. The bump is an
admin push, not a PR, so the required `expo-doctor` check does not run on it:
the branch keeps the pins of the build it came from. Delete the branch once
the release is published. If `main` has nothing unready, release from
`main` instead: no branch.

## Runtime versions

An OTA update reaches only builds with the same runtime version, which is the
native fingerprint (`runtimeVersion.policy: "fingerprint"`, guarded by
`mobile/src/runtimeVersion.test.ts`). It changes, splitting the runtime, when
any of these change in `mobile/`:

- a dependency with native code (anything autolinked), React Native, or the
  Expo SDK;
- `app.json` or `app.config.ts`, including `version`: every release has its
  own runtime;
- a config plugin (`plugins/`, or one a dependency ships), a local module
  (`modules/*/android`), or `patches/`;
- `eas.json`, `.gitignore`, the npm `scripts` in `package.json`, the app icons.

`google-services.json` is left out of the hash (`mobile/.fingerprintignore`),
so its contents, or its absence, do not change the runtime version.

It does not change for a change to Logjam GPS's own JavaScript or TypeScript,
`shared/`, or assets the bundle imports: that is what an update can carry.
