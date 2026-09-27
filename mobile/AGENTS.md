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

- **Read `mobile/DESIGN.md` before building or reshaping a screen;** extend the
  `src/ui` primitives, and update `DESIGN.md` with a convention change.
- **A new foreground/background colour pair joins `scripts/wcag-contrast.mjs`**
  in the same change; `KNOWN_FAILURES` only shrinks.
- **Map code follows the MLRN 11 rules:** read [0031](../docs/decisions/0031-mlrn-11-map-interaction-rules.md)
  before changing a layer, a press handler or a camera write.
- **A guest syncs nothing yet:** gate a new server call through
  `auth/capabilities.ts` so a guest makes none, and never add a guest-only
  write path. [0033](../docs/decisions/0033-guest-mode-is-dont-sync-yet.md)
- **A screen reached after the first sync shows its empty state on `data == null`,**
  never on `MirrorQueryState.loading`.
- **An aggregate of the user's own data filters out `syncRole === "shared"`.**
- **A card's border width never changes with state** (Fabric drops the children
  of a rounded `overflow: hidden` card); change its colour. [0039](../docs/decisions/0039-inbox-edits-are-outbox-ops.md)

## Privacy and battery

Going offline puts places on the phone, and a flat phone in a canyon is a
navigation failure. [0045](../docs/decisions/0045-on-device-data-privacy.md)

- **What leaves the device carries ids, not place data:** push payloads and
  crash reports (through `src/sentry/scrubEvent.ts`) never carry a place's
  name, coordinates or fields, and a region-of-interest bbox never reaches the
  server. [0046](../docs/decisions/0046-mobile-sentry-and-scrubber.md)
- **A new dependency can add Android permissions:** block each with
  `tools:node="remove"` and check the built APK (`aapt2 dump permissions`).
- **Nothing automatic wakes the radio or the CPU behind a dark screen:** a
  retry, poll or timer arms only in the foreground, and a sensor runs only
  while the screen that shows it is focused. The backgrounded recorder only
  appends points; any other background work needs the maintainer's sign-off. [0043](../docs/decisions/0043-background-work-battery-rules.md), [0040](../docs/decisions/0040-map-sensors-only-while-focused.md)

## Builds and verify

- `npm run typecheck`, `lint` and `test` gate every change. Nothing in CI
  bundles: run `npx expo export --platform android` before a Gradle build.
- **Metro does not rebuild `shared/`** (typecheck does): `make shared` first.
- **A fresh worktree needs real installs** (`npm ci` in `shared/` and `mobile/`):
  symlinked `node_modules` pass typecheck and vitest, then Metro fails. It also
  lacks the gitignored `.env`, `google-services.json` and `keys/`.
- **OTA is `npm run update:preview` / `update:production`,** never bare
  `eas update` (the signing key path); anything native needs a build. [0047](../docs/decisions/0047-signed-ota-updates.md)
