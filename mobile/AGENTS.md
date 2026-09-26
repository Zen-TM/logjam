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
  in the same change; `KNOWN_FAILURES` only shrinks. Text on a colour fill uses
  `INK`. [0021](../docs/decisions/0021-design-system-and-contrast-gate.md)
- **Every request sends `x-logjam-client`** (`src/config.ts`); the forced-upgrade
  lever depends on it. `versionCode` is EAS-managed.
- **Tokens live only in `expo-secure-store`.**
- **An Expo native module is instantiated once per JS context,** and there are
  two (the UI and the headless TaskManager relaunch): guard a process-global
  resource (file handle, sensor listener, wakelock) in a Kotlin `object`.
- **Guest mode is "don't sync yet":** never a guest-specific write path;
  `auth/capabilities.ts` is the only source of what is gated, and a guest makes
  no server call rather than a 401. [0033](../docs/decisions/0033-guest-mode-is-dont-sync-yet.md)
- **Things you made sync, maps you downloaded stay on the device:**
  `CATEGORY_SYNCS` in `src/saved/savedKeys.ts` declares which. [0010](../docs/decisions/0010-what-syncs.md)
- **Show an empty state on `data == null`,** never on `MirrorQueryState.loading`,
  in a screen reached after the first sync. [0038](../docs/decisions/0038-logbook-stats-computed-on-device.md)
- **An aggregate of the user's own data filters out `syncRole === "shared"`.**
- **A card's border width never changes with state** (Fabric drops the children
  of a rounded `overflow: hidden` card); change its colour. [0039](../docs/decisions/0039-inbox-edits-are-outbox-ops.md)
- **A cache that a fetch replaces replays the pending outbox ops over it**
  (`pendingInboxOps`). [0039](../docs/decisions/0039-inbox-edits-are-outbox-ops.md)

## Map (MapLibre, MLRN 11)

- **Never lower `nativeVersion` below 13.3.0:** a new `ErrorDeviceLost` in
  Sentry is that Vulkan bug returning. [0030](../docs/decisions/0030-maplibre-vulkan-and-native-sdk-floor.md)
- Layer styles go through the deprecated `style` prop; no imperative map call
  before `onDidFinishLoadingMap`; a pressable source handler calls
  `stopSourcePress(event)` first; anchors wire `onPress`, never `onSelect`; hit
  tolerances use `degreesPerDp`; a camera write goes through `setCameraStop` or
  passes `easing`. [0031](../docs/decisions/0031-mlrn-11-map-interaction-rules.md)
- The Protomaps layer JSONs are generated (`scripts/basemap/generate-style.mjs`).
- **Sensors run only while the map is focused and foregrounded** (`sensorsActive`);
  the heading never enters screen state, subscribe through `map/heading.ts`. [0040](../docs/decisions/0040-map-sensors-only-while-focused.md)
- **Before tuning a heading constant, read what the native module samples**
  (rate, sensor type, gating), and tune only from a hardware measurement. [0041](../docs/decisions/0041-compass-heading-pipeline.md)

## Offline, imports, sharing

- `offlineCapable` in the shared basemap catalog is the one source of what may
  be downloaded. A region download keeps the politeness envelope
  (`regionTileDownload.ts`), calls `assertSpaceFor` before anything large and
  never uses `apiFetch` on the tile path. [0034](../docs/decisions/0034-offline-region-downloads.md)
- **GeoPDF import takes a file URI, never bytes,** through `runGeoPdfImport`;
  bump `GEOPDF_PARSER_VERSION` when `tilePlan.ts` changes the tile list. [0035](../docs/decisions/0035-geopdf-import-by-file-uri.md)
- **Share (live, revocable) and Send a copy (a permanent file):** the verb
  matrix is `saved/assetActions.ts`; every surface renders `useSharePanel`; a
  verb is dimmed offline, never hidden. [0036](../docs/decisions/0036-share-versus-send-a-copy.md)
- **Places:** types come only from `useMirrorPlaceTypes`; a form re-seeds on the
  entity's id; a user's field is an "attribute" in copy (`ATTRIBUTE_NOUN`). [0037](../docs/decisions/0037-mobile-places-types-and-attribute-forms.md)

## Privacy and battery

Going offline puts place coordinates and names on the device. [0045](../docs/decisions/0045-on-device-data-privacy.md)

- App-private storage, no backup; app lock defaults off and turning it off
  needs the device authenticator.
- A dependency's manifest can add permissions: block them with
  `tools:node="remove"` and audit the built APK (`aapt2 dump permissions`).
- Push payloads carry opaque ids only; region-of-interest bboxes stay off the
  server; crash reports go through `src/sentry/scrubEvent.ts` and the consent
  gate. [0046](../docs/decisions/0046-mobile-sentry-and-scrubber.md)
- **Nothing automatic wakes the radio from the background;** a backgrounded
  recorder only appends points. [0043](../docs/decisions/0043-background-work-battery-rules.md)

## Builds and verify

- Cognito ids and the Sentry DSN are EAS env vars; `mobile/.env` is not
  uploaded to EAS.
- **OTA is `npm run update:preview` / `update:production`,** never bare
  `eas update` (the signing key path); anything native needs a build. [0047](../docs/decisions/0047-signed-ota-updates.md)
- `npm run typecheck`, `lint` and `test` gate every change. Nothing in CI
  bundles: run `npx expo export --platform android` before a Gradle build.
- **Metro does not rebuild `shared/`** (typecheck does): `make shared` first.
- **A fresh worktree needs real installs** (`npm ci` in `shared/` and `mobile/`):
  symlinked `node_modules` pass typecheck and vitest, then Metro fails. It also
  lacks the gitignored `.env`, `google-services.json` and `keys/`.
- Date tests run under a non-Sydney TZ (`logbook.test.ts`).
- `withLocalDebuggableRelease` keeps `DEBUG=false`, or expo-updates takes the
  dev-client path and assets resolve to empty URIs.
