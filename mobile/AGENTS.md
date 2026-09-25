# Mobile — Logjam GPS

React Native (Expo, dev-client + EAS Build — **not** Expo Go, native modules) +
TypeScript. In-field canyoning companion: offline maps, GeoPDF import, GPS
navigation, track recording, trip logging. Consumes generated artifacts (topo
tiles, GeoPDFs); does **not** generate them (that stays in Logjam Web). Design
reasoning lives in `docs/decisions/` (ADRs 0030–0047); this file keeps the rules.

## Dev loop

- **`npm run dev:android`** (`scripts/dev-android.sh`) finds the device, reverses
  every port the app dials on localhost (8081 Metro, 8080 API, 4566 MiniStack),
  installs the debug dev client if absent and launches it. `--build` rebuilds,
  `--logs` tails logcat, `--metro` runs Metro in the foreground, `--emulator`
  boots the `logjam` AVD first. Prefer a real phone: GPS, cameras and the
  biometric prompt only behave correctly there.
- `.env` points at `127.0.0.1`, which on the phone means THE PHONE: a missing
  `adb reverse` looks like an app bug, not an error. All three ports, per device.
  Any new pipeline that presigns S3 needs 4566 (the URL is built from
  `AWS_ENDPOINT_URL=http://localhost:4566`).
- Point a dev client at `127.0.0.1:8081`, never `10.0.2.2:8081` (emulator too):
  `plugins/withLocalApiCleartext.js` exempts loopback only.
- Native-dep changes: `npx expo prebuild -p android && cd android &&
  ./gradlew :app:assembleDebug`. On-device release APKs: **only**
  `./scripts/build-local-apk.sh`, never `gradlew` by hand (it sets
  `LOGJAM_LOCAL_API=1` and `SENTRY_DISABLE_AUTO_UPLOAD=true`, and deletes the
  stale JS bundle — `.env` is not a Gradle input).
- Maestro flows in `e2e/` (local, not CI — see `e2e/README.md`). A second
  identity: `EXPO_PUBLIC_FAKE_SUB=fake-bob-sub` (dev only, baked into the bundle).
- Debugging recipes (symptom → cause → fix) belong in the `local-testing` skill.

## Stack rules

- **Expo managed + config plugins + dev-client.** Add native capability via a
  config plugin + `npx expo install <pkg>`; never hand-edit `/ios` `/android`
  (gitignored, regenerated).
- **`shared/` is the single source of business logic** (`@logjam/shared`,
  resolves to `shared/dist`). Pure logic goes there with vitest tests, not in
  `mobile/`. `npm run typecheck` rebuilds `shared` first; **Metro does not** —
  after editing `shared/`, `cd shared && npm run build` before Metro sees it.
- **UI is a fresh RN component layer**; MUI is web-only. **Read
  `mobile/DESIGN.md` before building or reshaping any screen**; extend `src/ui`
  primitives, and update `DESIGN.md` in the same commit as a convention change.
- **Env:** `EXPO_PUBLIC_*`, non-secret, via `src/config.ts`. **Auth:**
  `aws-amplify/auth` (`useAuth.ts`); tokens only in `expo-secure-store`.
- **Client-version header on every request** (`x-logjam-client`,
  `src/config.ts`); the forced-upgrade lever depends on it. `package.json` is
  the one declaration of the version (guard: `versionAgreement.test.ts`);
  `versionCode` is EAS-managed — don't hand-set it.
- **An Expo native module is instantiated ONCE PER JS CONTEXT**, and there are
  two (UI + the headless TaskManager relaunch). Guard a process-global resource
  (file handle, sensor listener, wakelock) in a Kotlin `object`.
- **A second caller inherits the first one's guards**: grep every caller and
  sibling entry point.
- **Guest mode is "don't sync yet"**: never add a guest-specific write path.
  `auth/capabilities.ts` is the only source of what is gated; read
  `accountState` from `auth/AccountStateContext`; disable every server call for
  a guest rather than let it 401. [0033](../docs/decisions/0033-guest-mode-is-dont-sync-yet.md)
- **Empty state on `data == null`, never on `MirrorQueryState.loading`** in any
  screen reached after the first sync. [0038](../docs/decisions/0038-logbook-stats-computed-on-device.md)
- **Filter `syncRole === "shared"` out of any aggregate** of the user's own data.
- **A card's border WIDTH never changes with state** (Fabric drops the children
  of a rounded `overflow: hidden` card); change colour only. [0039](../docs/decisions/0039-inbox-edits-are-outbox-ops.md)
- **A cache a fetch replaces replays the outbox** (`pendingInboxOps`). [0039](../docs/decisions/0039-inbox-edits-are-outbox-ops.md)

## Map (MapLibre / MLRN 11)

- Vulkan backend on Android; **never lower `nativeVersion` below 13.3.0**; a new
  `ErrorDeviceLost` in Sentry is that bug returning. [0030](../docs/decisions/0030-maplibre-vulkan-and-native-sdk-floor.md)
- Rules from the MLRN 11 upgrade ([0031](../docs/decisions/0031-mlrn-11-map-interaction-rules.md)):
  every `<Layer>` has `key` = `id` (`src/map/layerKeys.test.ts`); layer styles
  go through the deprecated `style` prop; no imperative map call before
  `onDidFinishLoadingMap`; every pressable source handler calls
  `stopSourcePress(event)` FIRST (no test); anchors wire `onPress`, never
  `onSelect`; hit tolerances in DP via `degreesPerDp`, never a hand-written power
  of two; every camera write goes through `setCameraStop` or passes `easing`.
- A glyph on a line-placed symbol layer is ink-centred in its advance box
  (`src/map/routeArrowStyle.test.ts`). [0032](../docs/decisions/0032-line-symbol-glyphs-centred-in-advance-box.md)
- Protomaps layer JSONs are generated (`scripts/basemap/generate-style.mjs`);
  regenerate only with an extract/schema refresh.
- Sensors run only while the map is focused AND foregrounded (effects on
  `sensorsActive`, no test); the heading never goes into screen state — subscribe
  via `map/heading.ts`. [0040](../docs/decisions/0040-map-sensors-only-while-focused.md)
- Compass: one camera writer at a time; tune a heading constant only from a
  hardware measurement and `compassDiagnostics`. [0041](../docs/decisions/0041-compass-heading-pipeline.md), [0042](../docs/decisions/0042-declination-and-compass-fault-warnings.md)

## Offline, imports, sharing

- `offlineCapable` in the shared basemap catalog is the single source of what
  may be downloaded. Region downloads: [0034](../docs/decisions/0034-offline-region-downloads.md) —
  keep the politeness envelope (`regionTileDownload.ts`), no progress table,
  metered = `connectionAllowsMetered`, `assertSpaceFor` before anything large,
  no `apiFetch` on the tile-pyramid path. Re-run
  `shared/scripts/calibrate-basemap-tile-sizes.mjs` when size estimates move.
- GeoPDF import takes a **file URI, never bytes**; every entry point goes
  through `runGeoPdfImport`; bump `GEOPDF_PARSER_VERSION` when `tilePlan.ts`
  moves the tile list; never trust a Node profile. [0035](../docs/decisions/0035-geopdf-import-by-file-uri.md)
- Share (live, revocable) vs Send a copy (a file, permanent): the verb matrix is
  `saved/assetActions.ts` (tested); every surface renders `useSharePanel`; a
  verb is dimmed offline, never hidden. [0036](../docs/decisions/0036-share-versus-send-a-copy.md)
- Places: types come only from `useMirrorPlaceTypes`; forms re-seed on the
  entity's ID and compare with `sameFieldValues`; a user field is an
  "attribute" in UI copy (`ATTRIBUTE_NOUN`). [0037](../docs/decisions/0037-mobile-places-types-and-attribute-forms.md)

## Battery (a flat phone is a navigation failure)

- Nothing automatic wakes the radio from the background; a backgrounded
  recorder appends points only. [0043](../docs/decisions/0043-background-work-battery-rules.md)
- The recorder boost needs `patches/expo-location+19.0.8.patch` AND
  `buildFromSource: ["expo-location"]`; re-check both on every expo-location
  upgrade (`src/tracks/expoLocationPatch.test.ts`). [0044](../docs/decisions/0044-track-recording-fix-rate-and-map-boost.md)

## Privacy (see root `AGENTS.md`)

Going offline puts place coords/names **on the device**. [0045](../docs/decisions/0045-on-device-data-privacy.md)

- App-private storage, no backup. App lock defaults OFF (operator decision);
  turning it off needs the device authenticator. FLAG_SECURE follows the lock.
- Every on-disk store is declared in `offline/localStores.ts`
  (`localStores.test.ts`); one wipe path, `offline/wipeLocalData.ts` — extend
  it, never add another.
- A dependency's manifest can add permissions: block them with
  `tools:node="remove"` and audit the BUILT APK (`aapt2 dump permissions`).
- Push payloads carry opaque IDs only; no new unauth endpoints; 404-not-403.
- Region-of-interest bboxes stay off the server. Crash reports go through `src/sentry/scrubEvent.ts` and a consent gate;
  sourcemap upload is off. [0046](../docs/decisions/0046-mobile-sentry-and-scrubber.md)

## Builds (EAS)

- `eas.json`: `development` (dev client), `preview` (standalone APK, prod API),
  `production` (AAB). Cognito IDs and the Sentry DSN are EAS env vars, not
  committed; `mobile/.env` is not uploaded to EAS.
- `eas-build-post-install` builds `shared/dist` on the builder; keep it.
- OTA: JS-only fixes via `npm run update:preview` / `update:production` (never
  bare `eas update` — signing key path); anything native needs a build.
  [0047](../docs/decisions/0047-signed-ota-updates.md)

## Verify

- `npm run typecheck` + `lint` + `test` gate every change. **Nothing in CI
  bundles**: run `npx expo export --platform android` before any Gradle build.
- **A fresh worktree needs real installs**: `npm ci` in `shared/` and `mobile/`
  plus `cd shared && npm run build` — symlinked `node_modules` pass typecheck and
  vitest, then Metro fails (`Unable to resolve module proj4`). It also lacks the
  gitignored `mobile/.env`, `mobile/google-services.json` and `mobile/keys/`.
- **Date tests run under a non-Sydney TZ** (see `logbook.test.ts`). iOS = EAS
  build + real device.
- `withLocalDebuggableRelease` (`LOGJAM_LOCAL_API=1`) makes a trip-safe release
  that still allows `run-as`; keep its `DEBUG=false` half, or expo-updates takes
  the dev-client path and assets resolve to empty URIs.
