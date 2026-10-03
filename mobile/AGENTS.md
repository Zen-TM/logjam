# Mobile — Logjam GPS

Expo with a dev client and EAS Build, not Expo Go: it has native modules.

## Dev loop

- **`npm run dev:android`** reverses the ports the app dials (8081 Metro, 8080
  API, 4566 MiniStack), installs the dev client if absent and launches it.
  Prefer a real phone: GPS, cameras and the biometric prompt only behave there.
- **`127.0.0.1` in `.env` means the phone:** a missing `adb reverse` looks like
  an app bug, not an error. A new pipeline that presigns S3 URLs needs 4566.
  Point a dev client at `127.0.0.1:8081`, never `10.0.2.2` (emulator too).
- **Never hand-edit `/android` or `/ios`:** add native capability with a config
  plugin and `npx expo install`. After a native change,
  `npx expo prebuild -p android` then `./gradlew :app:assembleDebug` in `android/`.
  A release APK for a device is only `./scripts/build-local-apk.sh`.
- A second identity: `EXPO_PUBLIC_FAKE_SUB=fake-bob-sub` (dev only, baked into
  the bundle).

## Rules

- **UI work loads the `design-system` skill**: a screen, sheet, kit
  component, icon, colour or user-facing string.
- **Map code follows the MLRN 11 rules:** read [0015](../docs/decisions/0015-mlrn-11-map-interaction-rules.md)
  before changing a layer, a press handler or a camera write.
- **A guest syncs nothing yet:** gate a new server call through
  `auth/capabilities.ts` so a guest makes none, and never add a guest-only
  write path. [0007](../docs/decisions/0007-guest-mode-is-dont-sync-yet.md)
- **An aggregate of the user's own data filters out `syncRole === "shared"`.**

## Privacy and battery

Going offline puts places on the phone, and a flat phone in a canyon is a
navigation failure. [0006](../docs/decisions/0006-on-device-data-privacy.md)

- **What leaves the device carries ids, not place data:** push payloads and
  crash reports (through `src/sentry/scrubEvent.ts`) never carry a place's
  name, coordinates or fields, and a region-of-interest bbox never reaches the
  server. [0004](../docs/decisions/0004-mobile-sentry-and-scrubber.md)
- **A new dependency can add Android permissions:** block each with
  `tools:node="remove"` and check the built APK (`aapt2 dump permissions`).
- **Nothing automatic wakes the radio or the CPU behind a dark screen:** a
  retry, poll or timer arms only in the foreground, and a sensor runs only
  while the screen that shows it is focused. The backgrounded recorder only
  appends points; any other background work needs the maintainer's sign-off. [0013](../docs/decisions/0013-background-work-battery-rules.md), [0010](../docs/decisions/0010-map-sensors-only-while-focused.md)

## Builds and verify

- `npm run typecheck`, `lint` and `test` gate every change. Nothing in CI
  bundles: run `npx expo export --platform android` before a Gradle build.
- **Metro does not rebuild `shared/`** (typecheck does): `make shared` first.
- **A fresh worktree needs real installs** (`npm ci` in `shared/` and `mobile/`):
  symlinked `node_modules` pass typecheck and vitest, then Metro fails. It also
  lacks the gitignored `.env`, `google-services.json` and `keys/`.
- **OTA is `npm run update:preview` / `update:production`,** never bare
  `eas update` (the signing key path). A production update comes only from a
  `release/mobile-vX.Y.Z` branch, never `main`; anything native needs a
  release. [0009](../docs/decisions/0009-signed-ota-updates.md), [0023](../docs/decisions/0023-ota-runtime-is-the-native-fingerprint.md);
  procedure: `docs/operations/mobile-release.md`.
