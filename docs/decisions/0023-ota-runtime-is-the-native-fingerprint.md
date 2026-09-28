# 0023. An OTA update's runtime version is the native fingerprint, and a production update ships only from its release's branch

- **Date:** 2026-09-28
- **Status:** Accepted
- **Supersedes:** —

## Context

`expo-updates` (29, Expo SDK 54) delivers an OTA update only to builds whose
runtime version equals the update's. The runtime version is the promise that
the update's JavaScript runs on the build's native code: an update that calls
a native module, or a native API, the build lacks crashes it on launch, and
the phone keeps loading the same update.

`mobile/app.json` used `runtimeVersion.policy: "appVersion"`, so the runtime
version was `mobile/package.json`'s `version`. [0009](0009-signed-ota-updates.md)
chose code signing on that basis. Nothing tied the version to the native
code: the EAS `preview` builds of 2026-08-03 and 08-04 have runtime `0.1.0`,
and so would a build made today, after the upgrade to Expo SDK 54 (fc70ce6,
2026-08-13) and MapLibre React Native 11 (305db84). An update published from
today's `main` to `preview` would have gone to the August builds and loaded
SDK 54 JavaScript on their older native code.

Logjam GPS is now released by tag (`.github/workflows/deploy-mobile.yml`), and
that workflow fails unless the tag names `package.json`'s version, so every
store build has a version no other store build has. That leaves two ways for
JavaScript to reach a build whose native code it does not match:

- **An OTA hotfix keeps the version by design:** it has to reach the builds
  already in the field. If the fix carries a native change (a dependency with
  Android code, a config plugin, a `patches/` edit), `appVersion` sends it to
  every build of that version.
- **An update published from `main`** can need native code, an API route or a
  `shared/` change that a build cut weeks earlier lacks. The runtime version
  cannot see the last two.

## Decision

1. **The runtime version is the native fingerprint:** `runtimeVersion` is
   `{ "policy": "fingerprint" }`. `@expo/fingerprint` hashes what the native
   build is made of, so a build and an update agree only when their native
   inputs do. Guard: `mobile/src/runtimeVersion.test.ts`.
2. **A production OTA update is published only from
   `release/mobile-vX.Y.Z`,** a branch cut from the tag of the build it fixes,
   never from `main`, and it keeps that build's version. The fix lands on
   `main` first by PR, then is cherry-picked.
3. **Before publishing,** the runtime version of the checkout
   (`npx expo-updates runtimeversion:resolve --platform android`) equals the
   target build's (`eas build:view`). A mismatch means the update would reach
   no one, or the fix changed native code and needs a store build.

Rules 2 and 3 have no executable check; `docs/operations/mobile-release.md`
walks through them, and they are checked when an update is published.

## Consequences

- **Positive:** a native mismatch makes an update miss a build instead of
  crash it, without anyone having to notice the native change. Store builds
  need no hand-kept runtime rule beyond the version the tag check already
  enforces.
- **Negative:** the hash covers more than native code, so harmless edits also
  split the runtime: all of `mobile/eas.json`, `mobile/.gitignore`, the npm
  `scripts` in `mobile/package.json`, the app icons, and the contents of
  `google-services.json`, which `mobile/app.config.ts` adds only when
  `GOOGLE_SERVICES_JSON` is set. An update published from a checkout without
  that file, or after such an edit, reaches no build and says nothing, which
  is why rule 3 exists. The runtime version is a 40-character hash, not a
  version a person can read. Builds already installed with runtime `0.1.0`
  receive no further updates.
- **Neutral:** three config plugins change the native build from environment
  flags the hash cannot see (`LOGJAM_SENSOR_LOG` in `withSensorLogging.js`,
  and the flags of `withLocalApiCleartext.js` and
  `withLocalDebuggableRelease.js`). They are set only for the `development`
  profile and `scripts/build-local-apk.sh`, never for a `preview` or
  `production` build. Whether a `preview` and a `production` build of one
  commit get the same fingerprint, which a hotfix checked on a release
  candidate first relies on, is confirmed at the first dry run of
  `deploy-mobile.yml`.

## Alternatives considered

- **Keep `appVersion` and require a version bump for every store build:**
  the bump is already enforced by the tag check. Rejected because it cannot
  cover an OTA hotfix, which keeps the version by design, so a native change
  in the fix still reaches every build of that version and crashes it; and
  the release candidates of one version share its runtime despite any native
  fix between them.
- **`nativeVersion`** (version plus `versionCode`): rejected. EAS assigns
  `versionCode` remotely (`appVersionSource: "remote"` in `mobile/eas.json`),
  so the publisher would have to look it up, and it still cannot see a native
  change in an update.
- **A runtime version string bumped by hand:** rejected for the same reason
  as `appVersion`: it is correct only while someone remembers.
- **Publishing production updates from `main`:** rejected. The fingerprint
  catches a native mismatch but not JavaScript that needs an API route or
  data shape the build's era lacks, and it ships everything merged since the
  release instead of the one fix.
