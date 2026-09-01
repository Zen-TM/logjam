# Mobile — Logjam

React Native (Expo, dev-client + EAS Build — **not** Expo Go, native modules) +
TypeScript. In-field canyoning companion: offline maps, GeoPDF import, GPS
navigation, track recording, trip logging. Consumes generated artifacts (topo
tiles, GeoPDFs); does **not** generate them (that stays web-only). Full product
plan + staged execution: `.claude/mobile-plan/` (local, not committed).

## Status

Stage 0 (scaffold, spikes, min-version lever, CI), Stage 1 (Cognito auth,
apiFetch, read-only browse screens, Sentry scrubber), Stage 2 (map core:
raster + Protomaps vector basemaps, canyon overlay + labels, raster + vector
topo overlays with the user vectorStyle), Stage 3 (push, delivery gated on
operator FCM), and Stage 4a-core (offline Protomaps regions: `src/offline/`
registry + downloads + app lock, `/basemap/region-clip` API) are built.
SIXMaps offline regions are built too: the ToS gate in `stage4a-basemaps.md` §2 was
cleared by the operator for the three CC-licensed NSW sources, and `offlineCapable`
in the shared basemap catalog stays the single source of what may be downloaded
(see "Offline basemap downloads" below).

Dev loop on a connected Android device or emulator:
**`npm run dev:android`** (`scripts/dev-android.sh`) — finds the device and
explains the fix when it can't, reverses every port the app dials on localhost
(8081 Metro, 8080 API, 4566 MiniStack — `.env` points at 127.0.0.1, which on the
phone means THE PHONE, so a missing tunnel looks like an app bug, not an error),
installs the debug dev client if absent, and launches it. `--build` rebuilds it,
`--logs` tails its logcat, `--metro` runs Metro in the foreground, and
`--emulator` boots the `logjam` AVD first and waits on `sys.boot_completed` (not
`adb wait-for-device`, which returns minutes before the launcher exists). Prefer a
real phone when one is attached — GPS, cameras and the biometric prompt only
behave correctly there. Then `npm start` (Metro);
native-dep changes need `npx expo prebuild -p android && cd android &&
RTK_DISABLED=1 ./gradlew :app:assembleDebug`. Maestro flows in `e2e/` (local,
not CI — see `e2e/README.md`).

**MapLibre runs the Vulkan backend on Android** (app.json MLRN plugin
`nativeVariant: "vulkan"`): the OpenGL backend silently renders no symbol
layers (text or icons) on modern emulators (maplibre-native #3617 — an
`isEmulator()` fingerprint bug, so EMULATOR-ONLY; it does not affect a real
device). Don't revert without retesting labels on emulator + physical device.

**The native SDK pin is a safety floor, not a default** (`nativeVersion`,
currently **13.5.0**; MLRN 11.3.6's own default is 13.2.0). Vulkan on Android
crashed on screen lock/unlock until **13.2.0** (maplibre-native #4303 —
`AndroidVulkanRendererBackend`, Vulkan-only, "OpenGL works fine"), and until
**13.3.0** it recreated the whole renderer backend on every surface-create
(#4324, PR #4323). We shipped 12.3.1, i.e. below both, and a field trip
produced four `SIGABRT`s on resume, each preceded by a storm of
`vk::Queue::submit: ErrorDeviceLost` (Sentry `REACT-NATIVE-5`) plus the
non-fatal form: a map that renders nothing while the scale bar still tracks
the camera, because `onRegionIsChanging` keeps firing on a dead device.
**Never lower this pin below 13.3.0, and treat any new `ErrorDeviceLost` in
Sentry as this bug returning.**

**MLRN 11 is a Fabric library; MLRN 10 was not.** 10.4.2 shipped no
`codegenConfig` and nine legacy `ViewManager`s, so with `newArchEnabled: true`
the entire map ran through RN's legacy interop layer (visible in logcat as
`Could not find generated setter for class …MLRNPointAnnotationManager`).
11.3.6 has real Fabric components. Two things follow. The API is
GL-JS-shaped now — `Map`/`GeoJSONSource`/`<Layer type="…">`, `center`/`zoom`/
`bearing`/`duration` on camera stops, and every event arrives as
`event.nativeEvent` — so anything written against an MLRN 10 example needs
translating. And **layer styles go in through the deprecated `style` prop, on
purpose**: MLRN 11 wants the spec's `paint`/`layout` split, but our generated
Protomaps defs (`scripts/basemap/generate-style.mjs`) and
`buildTopoVectorLayerDefs` both emit one merged camelCase object for web
parity, and MLRN splits it for us. That prop goes in MLRN v12; the generator
and the two `Layer` call sites (`ProtomapsLayers.tsx`, `TopoVectorOverlay.tsx`)
have to move together when it does.

**Every `<Layer>` needs a `key`, and it must equal its `id`.** MLRN 11 freezes
a layer's id on first render (`useFrozenId`) and throws "`id` cannot be
changed" if a fiber is later rendered with a different one — which takes the
whole app to the root error boundary. The trap is that
`cloneReactChildrenWithProps` FILTERS FALSY CHILDREN OUT before `Children.map`,
so a conditional layer does not hold its slot: keyless siblings of the same
type reconcile by index, and React reuses one layer's fiber for the next one
along. Shipped this way once — the user-location beam is conditional on there
being a heading, so pressing locate and then leaving the map crashed the app.
Guarded by `src/map/layerKeys.test.ts`, which scans every `.tsx` for a `<Layer>`
without a key.

**Never call an imperative map command before the map exists.** MLRN 11's
native side is written with non-null assertions — `MLRNMapView.kt` alone has 32
`mapLibreMap!!`, including `getBounds()`. Calling one before the map is created
throws a Kotlin NPE, which React Native promotes to a HOST exception and tears
down the whole React instance: the screen goes blank and the app has to be
killed, and because it is not a JS error the root error boundary never sees it.
`RegionDownloadScreen` asked for `getBounds()` on mount and so raced the map —
"save maps offline" worked or blanked the app depending on who won. Gate any
such call on `onDidFinishLoadingMap`, and prefer the bounds carried on
`onRegionDidChange` over asking at all.

**A source's press bubbles to the MAP in MLRN 11.** MLRN 10 let a source's
`onPress` consume the tap; MLRN 11 emits it on the source AND on the `Map`
(documented on `MapProps.onPress`). Tapping a canyon, route, track, import or
waypoint therefore also ran the map's handler and opened the "This point" sheet
on top of the one the user asked for — and with a point tool armed it placed a point
at the same tap. Every pressable source handler calls `stopSourcePress(event)`
(`src/map/sourcePress.ts`) FIRST, before any early return: a handler that bails
without calling it still leaks the tap. Not enforced by a test — the handlers
are passed by reference, so a source scan cannot see them — so it is a
convention to check when adding a pressable source.

**A tap on an anchor is `ViewAnnotation`'s `onPress`, plus a map-press hit
test for the ring outside the handle.** (Corrected 2026-08-24 — the earlier
version of this rule had it the other way round and was wrong.) On Android a
`ViewAnnotation` is a `Symbol`, and `SymbolManager`'s click listener returns
`true` (`MLRNMapView.kt` `createSymbolManager`), so a tap inside the rasterised
34 dp handle is CONSUMED and `MLRNMapView.onMapClick` never runs. Three things
follow, and all three were broken until this batch:
- Wire **`onPress`**, never `onSelect`. `MLRNPointAnnotation.onSelect` fires
  only on the annotation's false→true transition and nothing here ever
  deselects it, so a second tap on the same anchor delivered no event at all.
  `onPress` fires on every tap (`MLRNPointAnnotation.kt`).
- `anchorIndexAtPress` (`src/map/anchorHit.ts`, tested) only ever sees the
  ring BETWEEN the 17 dp handle and `ANCHOR_GRAB_DP` (22 dp, a 44 dp target).
  It is not dead weight — it is the margin — but it is not the main path, and
  when the tolerance was smaller than the handle it could not fire at all.
- **Tolerances are DP and come from `degreesPerDp` (`src/map/scaleBar.ts`,
  tested).** MapLibre Native is handed the view size divided by the display
  density, so its screen space is density-independent and its zoom is
  512-based. The anchor reach inlined a 256-based world AND divided by
  `PixelRatio.get()`; the two errors did not cancel, and a stated 20 dp measured
  under 15 dp. Nothing may write its own power of two for this.

**A drag under the touch slop is a TAP.** `ViewAnnotation` is `draggable`, so a
finger that moves two pixels while tapping arrives as a drag, and committing it
moved the anchor a metre and selected nothing — the operator's report that
deleting a point was "virtually impossible". `RouteDraftLayer` gates the drag on
`dragIsTap` (`anchorHit.ts`, `ANCHOR_TAP_SLOP_DP` = Android's own 8 dp): below
the slop nothing previews, nothing commits, and the gesture is forwarded as a
press. Past the slop it stays a drag for the rest of the gesture, so a finger
that wanders out and back still commits. The drop's own press is suppressed by a
WINDOW (`ANCHOR_DROP_SELECT_MS`), not by a flag — the flag it replaces was
cleared only by the next press, so a drop that produced none stayed armed and
swallowed the user's next real tap.

**A press-and-hold on an anchor reaches the MAP as well as the annotation.**
MLRN 10's `PointAnnotation` consumed the touch that starts a drag; MLRN 11's
`ViewAnnotation` does not, so the map's `onLongPress` also fires and the
route tool inserted a point where the finger went down — dragging an anchor
left a spare one behind. `insertAnchorNear` now bails on a press that lands on
an existing anchor (`src/map/anchorHit.ts`, tested). It is a hit test rather
than an "is a drag running" flag because the native long-press and the
drag-start callback race, and position cannot arrive too late.

**An omitted `easing` is a JUMP in MLRN 11.** MLRN 10's `animationMode`
defaulted to EASE; the native prop now declares
`WithDefault<NativeEasingMode, "none">`, so a stop naming only a duration
teleports. Every camera write goes through `setCameraStop`, which applies
`withDefaultEasing` (`src/map/cameraStop.ts`, tested) to restore the old
behaviour — but only when there is a duration to ease over, because a
`duration: 0` stop (every pinch frame, the post-settle reset) is a deliberate
jump. A camera call that bypasses that helper must pass `easing` itself.

**A glyph on a line-placed symbol layer must have its ink CENTRED IN ITS
ADVANCE BOX.** MapLibre centres such a label on the box the font declares, not
on the ink, so a glyph drawn off-centre inside its own box is drawn off-centre
on the line — and with `textKeepUpright` off it rotates with the line, so the
error swaps sides wherever the line doubles back, which reads as jitter rather
than as an offset. The route direction arrows used `\u203A` (a single angle
QUOTE): measured out of the shipped SDF pack its ink sits 2.0px low at the 24px
glyph em, half the width of the 3dp line it rides on. `\u2192` measures 0.0/0.0,
because arrow glyphs are drawn on the font's math axis, which is the assumption
MapLibre's centring makes. Punctuation is not. Guard:
`src/map/routeArrowStyle.test.ts` reads the glyph out of
`assets/basemap/basemap-assets.zip` and fails on both an off-centre glyph and
one the pack does not ship (the second is otherwise silent — a missing glyph
renders no text and no error).

Protomaps basemap layer JSONs are generated by
`scripts/basemap/generate-style.mjs` (committed output in `src/map/basemap/`);
regenerate only together with an extract/schema refresh.

## Stack rules

- **Expo managed + config plugins + dev-client.** Add native capability via a
  config plugin + `npx expo install <pkg>`, never by hand-editing `/ios` `/android`
  (they are gitignored, regenerated by prebuild/EAS).
- **`shared/` is the single source of business logic.** Import via `@logjam/shared`
  (`file:../shared`). Same **shared-rebuild rule** as the rest of the repo: after
  editing `shared/`, `cd shared && npm run build` before Metro picks it up (imports
  resolve to `shared/dist`). Pure logic (parsers, transforms, estimators, GeoPDF
  dict parsing, sync state machine helpers) belongs in `shared/` with vitest tests,
  reused by web + mobile — do not fork it into `mobile/`. `npm run typecheck`
  rebuilds `shared` first (a `pretypecheck` hook), so the "has no exported
  member" that really means "stale `shared/dist`" cannot reach you through that
  command. Metro is NOT covered — it resolves `shared/dist` directly, so an edit
  to `shared/` still needs the build before the bundler sees it.
- **UI is a fresh RN component layer.** MUI is web-only; do not port it. Reuse the
  design tokens/logic, rebuild the presentation. Design system: Claude Design
  project "Logjam Mobile" via DesignSync (`/design-login` first).
- **Read `mobile/DESIGN.md` before building or reshaping any screen.** It owns the
  layout skeleton (hero + pinned filter rail + scrolling list), category hue/glyph
  identity, radius/type/depth scales, action and destructive-confirm rules, and
  state handling. Reference implementation: `src/saved/SavedScreen.tsx`. Extend the
  `src/ui` primitives rather than hand-rolling a local variant, and update
  `DESIGN.md` in the same commit as any convention change.
- **Env:** `EXPO_PUBLIC_*` (parallels web `VITE_*`). Non-secret only. Read through
  `src/config.ts`, which **fails loudly** on a missing API URL. Dev/prod parity via
  env files + EAS build profiles.
- **Auth:** `aws-amplify/auth` against the same Cognito pool as web (`useAuth.ts` is
  the reference flow). Tokens in `expo-secure-store` (Keychain/Keystore) — never
  AsyncStorage, never plain SQLite.
- **Guest mode: the app runs without an account.** A fresh install lands on the
  landing screen (`screens/LandingScreen.tsx` — sign-in form, with "create an
  account" and "continue without an account" subdued beneath it); "continue
  without an account" first shows the storage explainer as a state of that
  screen, and only "Continue anyway" sets the `prefsDb` flag and mounts the same
  `AppShell` with `accountState: "guest"`.
  - **The mechanism is "don't sync yet", not a separate storage path.** Guest
    mutations write the mirror and enqueue to the outbox exactly as they always
    do — `AppShell` simply never calls `registerSyncTriggers()`, so the mutation
    handler is never installed and the queue accumulates. Linking an account
    starts the engine and the first cycle drains it. There is no import, no
    id remapping (ids are client-minted UUIDv4 already) and no merge code; the
    delta pull is `INSERT OR REPLACE`, so linking into an account that already
    has data merges rather than replaces. **Never add a guest-specific write
    path** — that equivalence is the whole feature.
  - **Custom fields are the one guest-mode exception to that equivalence.**
    Definitions are a USER PREFERENCE, not an entity, so there is no outbox op
    to accumulate — a guest's list lives in `sync_state` (`customFields/
    fieldDefsStore.ts`), and `adoptLocalFieldDefs` carries it up to the account
    on link, before the outbox pushes the trips that reference its keys.
    `sync_state` rather than `prefsDb` because `wipeAllLocalData` spares
    `prefsDb`, and field labels are the user's words about their canyoning, not
    a statement about the handset. Values were always local for both.
  - **`auth/capabilities.ts` is the single source of what is gated**, and the
    only place "Needs an account" / "Needs a connection" are spelled. Screens
    read `accountState` from `auth/AccountStateContext`, never from the
    preference directly (that read wouldn't re-render on link). `needs-account`
    beats `needs-connection` — see DESIGN.md §10.
  - Every `useApiQuery` and every effect that talks to the server must be
    disabled for a guest, not left to fail. A guaranteed-401 request per screen
    open is a battery cost and a permanently red sync health line.
  - **Crash reports are consent-gated** (`sentry/crashReportPreference.ts`):
    a guest has no account for telemetry to "stay within", so `initSentry()`
    no-ops until the question is answered (default OFF). It is asked ONCE, as a
    sheet mounted from `App.tsx` beside `AppShell` (`screens/CrashReportConsent
    .tsx`), on the first arrival into the app — guest or signed in. Both answers
    (including "Not now", an explicit off) store a choice, which is what stops it
    nagging; `needsCrashReportChoice()` is the whole decision and is tested in
    `sentry/crashReportPreference.test.ts`. Installs that predate the toggle are
    grandfathered by `grandfatherCrashReports()`, and an explicit no is never
    overwritten.
- **An Expo native module is instantiated ONCE PER JS CONTEXT**, and this app
  has two: the UI, and the headless context TaskManager relaunches for a
  background location delivery. Anything guarding a PROCESS-global resource — a
  file handle, a sensor registration, a wakelock — must live in a Kotlin
  `object`, not in instance fields, or the second context duplicates it. Listeners
  especially: `unregisterListener` matches on object identity, so one context can
  never unregister the other's. `logjam-sensors` shipped this bug and opened the
  same log file twice with two sets of sensors running.
- **A second caller inherits the first one's guards.** Grep every caller before
  changing a guarded function, and every sibling entry point when adding one:
  the share sheet skipped the picker's size cap, `resumeTrackRecording` skipped
  `startTrackRecording`'s rollback, the camera path skipped
  `locationPermission.ts`'s denial handling. Same bug, three times, all found in
  one audit.
- **Client-version header on every request** (`x-logjam-client: mobile/<semver>`,
  `src/config.ts`). The forced-upgrade lever depends on it — do not drop it.

## Offline basemap downloads

`src/map/RegionDownloadScreen.tsx` frames an area (edge-handle selector, pure maths
in `regionFrame.ts`), prices it, and enqueues one job per selected map through
`src/offline/regionDownloadQueue.ts`. Enqueue happens on the Save tap and the
naming prompt (a sheet, defaulting to "Region N" from `regionName.ts` — no
geocoding, no coordinates) opens OVER a download already running; the screen then
leaves for the Saved tab's Regions filter, which is where progress is reported as
cards. `RegionDownloadProgressScreen.tsx` was deleted (2026-08-16) with its Done
gate: a run outlives the screen that started it, and a screen whose only job is
to be waited on is one the user leaves anyway. Two task kinds share that queue
(stage4a §9): `tile-pyramid` fetches SIX raster tiles straight from the provider
into an on-device MBTiles (`regionTileDownload.ts` + `regionMbtiles.ts`), and
`http-file` pulls the self-hosted Protomaps clip through our API
(`regionDownloads.ts`). Both end in a `map_artifact` row, which is the only thing
the map resolver ever sees.

**The vector clip needs a local archive, and its absence is a 503 that reads as
a client bug.** `POST /basemap/region-clip` shells out to `pmtiles extract`
against `PROTOMAPS_ARCHIVE_URI`; with either the binary or the archive missing
the endpoint answers 503 and the download screen reports the vector map as
unavailable while the SIX rasters download fine. Local dev has neither by
default. To fix a box: put the pinned `pmtiles` release on PATH (same version
`api/Dockerfile` installs), fetch
`s3://logjam-topo-jobs/master/basemap/protomaps-nsw.pmtiles` (~740 MB), and set
`protomaps_archive_uri` in a gitignored `*.auto.tfvars` under
`infra/terraform/envs/local/` so `make dev` renders it into `.env.local`. The
archive stops at z15, which is also the endpoint's `MAX_CLIP_ZOOM` — a request
above it is a 400, as is one outside the NSW extract.

**The politeness envelope is not optional** (`regionTileDownload.ts` header):
concurrency 2, a token bucket refilling 3 tiles/s with ±20 % jitter, no
app-identifying headers on a provider request (never `x-logjam-client`, never an
auth token), and an immediate full stop on 403/429 rather than retries. Load shape,
not disguise — do not "optimise" the pace.

**The file is the checkpoint.** A partial MBTiles carries `logjam:build_state`
(plan hash + the 404 gap list) and is never registered as usable; resume diffs the
plan against the tiles present, and unfinished downloads are discovered by reading
the region directory (`listUnfinishedRegions`), not from a progress table. The
`region_download` table and `downloadMachine.ts` were the original plan's version
of this and were **deleted** (2026-08-13): nothing ever installed either — the
queue shipped its own `RegionJobState` union and `PausedReason` now lives in
`regionTileDownload.ts`. Don't reintroduce a progress table.

**Metered means expensive, not cellular.** Region downloads answer to the same
rule as every other metered job — `connectionAllowsMetered` in
`networkPolicy.ts`, which reads the platform's `isConnectionExpensive`. A
tethered hotspot is Wi-Fi by type and mobile data by cost. The download screen's
"Use mobile data" row appears on the same answer.

**Nothing large is written without asking whether it fits.** `assertSpaceFor` /
`hasSpaceFor` (`offline/freeSpace.ts`) gate the region clip (after the POST
reports its size), the overlay bundle (from the first progress tick — a presigned
GET URL can't be HEADed), the GeoPDF pyramid (from its plan estimate) and, via
those, both auto-downloaders. There is still **no eviction** anywhere: nothing
reclaims an artifact by age or pressure, which is why the precheck matters.

**Pause is a tile-pyramid affordance only** (`offline/regionJobStatus.ts`). The
clip is one `expo-file-system` transfer with no mid-flight stop. The same file
owns the "is this run over?" answer Saved's cards read: a job paused by `user` or
`provider-backoff` is *settled* (nothing auto-resumes those, by design) even
though it is not *finished*, so a card never reports work that will never move.

**The offline map is drawn to its own edges.** With "Offline maps only" on (or no
signal), `src/map/offlineMask.ts` fills everywhere outside the downloaded regions
with the page colour, mounted directly above the basemap band. Two things are load-
bearing there: the mask is a MultiPolygon of the COMPLEMENT as disjoint rectangles
(a world polygon with a hole per region breaks the moment two saved areas overlap),
and its `layerIndex` is `1 + basemapLayerCount` — an offline basemap mounts one
raster layer *per region*, all asking for index 1, so assuming a single basemap
layer buries the mask under one of them and it renders half the screen.

**Every region download also saves the DEM, and that is not optional.** The
plan in `shared/src/mapRegionEstimate.ts` appends a `terrarium` source
(`DEM_SOURCE_ID`) to every run: one flat level at `DEM_TILE_ZOOM`, priced into
the same size estimate, tile cap and free-space check as the basemaps, and
enqueued as an ordinary `tile-pyramid` job whose `zMin === zMax`. It lands as a
`dem-region` artifact — same group id as the run, so Saved shows it inside the
area's card and deleting the area takes it — which the resolver never draws.
Without it, elevation profiles, point heights and route gain/loss die the moment
the phone loses signal, which is the trip the download exists for. The reader is
`offline/demLookup.ts` (MBTiles → `demPng.ts` → the shared pixel maths), wired
into `useElevationProfile` LOCAL FIRST: saved regions answer, and only a line
nothing on disk covers goes to the API. That also gives a guest elevation, which
the API path never could.

**Size estimates are measured, not guessed.** `shared/src/mapRegionEstimate.ts`
holds per-source, per-zoom tile sizes calibrated by
`shared/scripts/calibrate-basemap-tile-sizes.mjs` (bush AND town samples — a
bush-only calibration read 40 % under for a Katoomba download) plus a measured 7.1 %
MBTiles container overhead. Re-run the script and update both together; a test
asserts the range still brackets a real 34-tile download.

## GeoPDF import

`src/geopdf/importPipeline.ts` takes a **file URI, never bytes**, and that is a
hard rule. Every phase before rasterising used to run the whole file through the
JS heap — a sync read, a `Uint8Array` handed to expo-crypto (a second full copy
across the bridge), a sync write back out, and on the share-sheet path a base64
read plus a hand-rolled `atob` over millions of elements — all on the UI thread
before the first tile. Hashing is now native and streamed
(`LogjamPdfRenderer.sha256File`), copying is a filesystem copy, and the bytes
enter JS exactly once, for the pdf-lib parse, inside a function scoped so they
become unreachable the moment it returns.

**Hermes has no JIT, so a per-byte JS loop is ~70× slower than it profiles on a
laptop, and that is where the import's freeze actually was.** pdf-lib scans
forward for `endstream` one byte at a time whenever a stream's `/Length` is an
indirect reference, which is 540 of the 541 streams in an NSW topo sheet: 480 ms
of parse in Node became 35 SECONDS on device, one 3.9 MB stream of it a single
unbroken 16.8-second block of the UI thread. `shared/src/geoPdfImport/
fastStreamScan.ts` replaces that one method with the same algorithm driven by
native `Uint8Array.indexOf` — parse 1.5 s, worst stall 228 ms — and
`fastStreamScan.test.ts` runs pdf-lib's original and the replacement side by
side over real files asserting every offset matches. **Never profile this
pipeline in Node and believe the number**; the import logs its own phase
timings and the worst JS-thread stall it caused, once per run, and that log is
the measurement that counts.

**Guards come before the expensive step, not after.** Every incoming file is
staged through `imports/stagedFile.ts`, which stats it and refuses it BEFORE the
copy (the 300 MB GeoPDF cap used to be checked after a full copy into
app-private storage, and the vector cap existed only in the picker path while
the share sheet read the whole file into one JS string). The GeoPDF ceiling is
**64 MB**, not 300: `parseSourcePdf` is the surviving whole-file read and an
Android app heap is 256-512 MB, so a higher cap only bought an OOM kill.
`buildTilePlan` caps the plan at `MAX_GEOPDF_TILES` by stepping zMax down, and
`estimateGeoPdfImport` prices the run before the first tile.

**A resume must describe the same plan.** `resumableFrom` (shared, beside the
planner) compares `GEOPDF_PARSER_VERSION`, `zMax` and `plan.tiles.length` before
honouring a checkpoint's cursor — zMax alone let a planner change replay half of
a *different* tile list and register the holed map as ready. **Bump
`GEOPDF_PARSER_VERSION` whenever anything in `tilePlan.ts` moves the tile list.**

**The registry row is written before the file.** `imports/geopdf/<sha>/` is
created after `insertGeoPdfImport`, so a kill mid-copy leaves a row with no file
(which the resume path reports and the user can discard) rather than a full-size
orphan PDF nothing sweeps.

Every entry point (picker, account GeoPDF, share sheet, Wi-Fi auto-download)
goes through `runGeoPdfImport` in `src/geopdf/importRunner.ts`, which is also
the "one import at a time" guard — two at once would fight over the single
native executor and, for the same file, over the same directory. See DESIGN.md
§6 for why it's a background card rather than a screen.

**The rasteriser reports where its milliseconds went** (`renderMs`/`encodeMs`
per batch, logged once per import as counts and durations only). Measured on the
emulator for a 336-tile 1:25 000 sheet: render 60 s, PNG encode 24 s, everything
else 15 s. pdfium re-walks the whole page's content on every `render()` call
regardless of how small the region is, which is why render dominates and why
sharing one render across a block of tiles is the available big win — it is not
built, because it would have to move the mesh warp's lattice off each tile's own
`srcRect`, and getting that wrong produces a confidently misplaced map.

## Sharing and sending (2026-08-22)

**TWO VERBS, and they are not variants of each other.** The wording is the
feature — a user who thinks a sent file can be taken back has been misled by
the UI, not by the API.

- **Share** — a LIVE, revocable view of a server-backed row the sender still
  owns: waypoints, routes, LiDAR topo jobs, GeoPDF jobs, and canyons. The
  recipient can view and export, never edit. `POST /shares` (canyons keep their
  own `/canyons/:id/share`).
- **Send a copy** — a FILE handed over. Once accepted it is the recipient's own,
  editable, permanent, and there is NO revocation: imports, recorded tracks
  (serialised to GPX at send time) and GeoPDF imports. `POST /file-sends/*`,
  three-phase like media upload, expiring after `FILE_SEND_TTL_DAYS`.

**Which kind gets which verb lives in `saved/assetActions.ts` and nowhere
else**, and the matrix has an executable check (`assetActions.test.ts`, "the
share / send-a-copy verb matrix"). A descriptor withholds a verb rather than a
screen hiding it — `share` is absent on a row shared WITH you, `sendCopy` is
absent on an import with no retained original and on an empty recording.

**Every surface renders ONE panel** — `useSharePanel` in `src/sharing/
SharePanel.tsx`, for both verbs and every kind, canyons included. It returns
`{ title, body, footer }` (plus the `sharing` state the canyon screen's
at-a-glance section reads) and the caller spreads those onto the sheet it
already owns, because a sheet's primary action belongs in `BottomSheet`'s
pinned `footer` (DESIGN.md §6) and nothing may open a second sheet. Which verb
it shows follows `target`: `entity`/`canyon` grant a live view (tap acts
immediately — it is revocable), `copy` ticks a box and waits for the footer
button (a send cannot be undone). The promise banner states which one it is —
accent + eye for Share, warning + triangle for Send a copy — above an
always-present search field and the friend rows. Do not hand-roll a picker.

**The promise is NOT a prop.** Both sentences (`SHARE_BLURB`, and the canyon's
own, which names notes and photos and says trip logs stay private) live in
SharePanel.tsx and are chosen by target kind, as is the revoke confirm. A
canyon is shared from TWO components — its detail page and
`canyons/CanyonOptionsSheet.tsx` (a sub-mode of the per-canyon sheet, which the
Canyons list AND a tapped map pin both render) — and a wording argument at each
call site is how those drift. The verb ROWS
carry no subtitle for the same reason: the panel states the promise where the
user is about to act on it, rather than twice in two voices.

**`useSharing`'s `calls` must be memoised on the item's ids**, and the panel is
what does it. The hook reloads when they change, so a `calls` rebuilt per
render would reload forever — and the previous shape (capture the first
render's calls, never look again) was invisible only while every caller mounted
the hook alongside its item. The panel mounts ABOVE the item, at screen level,
so it started on a placeholder and answered every open with "no share target".
Object-literal `target` props are keyed the same way (`targetKey`): using the
object itself reset the copy-mode selection on every render, so a tap on a
friend appeared to do nothing.

**A share verb is DIMMED offline, never hidden** — `useShareRowProps(online)`
(SharePanel.tsx) is what every Share / Send a copy row spreads, so all six say
"Needs a connection" (or "Needs an account") in a subtitle and refuse the tap,
instead of the row disappearing. Sharing is the first thing most saved items
offer that needs the network at all, so it is the row a user is most likely to
go looking for and not find. Consequence for LiDAR topos: the verb is withheld
only on `syncRole === "shared"` — a job we KNOW is someone else's — because an
overlay rebuilt from a downloaded artifact carries no `syncRole` at all
(`map/topoOverlays.ts`), and treating unknown as "not yours" is what made the
verb vanish offline.

**A verb whose panel needs space is rendered INSIDE the sheet that owns the
verb, never handed to the caller as a callback.** A callback is only as good as
the caller that remembers to pass it: the Share verb shipped invisible once
because it was wired into `SavedScreen`'s inline sheet while routes actually
open `routes/RouteOptionsSheet.tsx`. The render sites are listed in
`assetActions.ts`'s header — check all of them when adding a verb.

**Imports keep their ORIGINAL BYTES** (`vector_import.sourcePath`) alongside
the derived GeoJSON, and a send ships the original. GPX → GeoJSON is lossy —
`ImportedFeature.properties` keeps only `name` and `coordTimes`, so `<desc>`,
`<sym>`, `<extensions>`, `<metadata>`, the `rte`/`trk` distinction and
multi-`trkseg` grouping are all discarded — so a round trip through the
derivation would hand a friend less than the sender has. A KMZ is stored as the
KML extracted from it (`writeAsStringAsync` is UTF-8 and would corrupt a zip).

**The Saved category is `import`, labelled "Imports"** — renamed from
`vector` / "GPX & KML" because the tab holds whole FILES that may contain
points and polygons, and naming it for lines promised something the type does
not guarantee. **"Way" is the umbrella term for route-or-track** in prose and
labels only; the `Route` and `Track` types stay distinct everywhere. It names
one panel: `canyons/AddWaySheet.tsx`, every way of filling a canyon's single
route slot, opened from the empty slot and from the replace row alike.

**A received copy is labelled `Copy` with "from <sender>" in its subtitle, never
the `Shared` pill.** On a route that word means live/revocable/read-only; a
received copy is the recipient's own, editable and permanent, and reusing the
word for opposite promises is exactly the confusion the two verbs exist to
prevent.

**`accepted` means the download URL was ISSUED, not that the file arrived.**
The row flips when accept returns, so a recipient who accepts on a flaky
connection is `accepted` with no file. Accepted rows stay downloadable until
the TTL and the notification keeps offering "Download again"; that is the
mitigation, and closing the gap properly would need an S3 access-log read or a
client confirm callback.

**A lapsed send is REPORTED to whoever missed it, and to nobody else.** At
expiry the reaper deletes the notification of every recipient who already saved
the copy (nothing to tell them) and keeps it for everyone who did not, stamped
with the filename. From then on a `file_sent` notification with no send row
means exactly one thing — expired unsaved — because every other way a recipient
row disappears deletes the notification in the same transaction (decline in
`routes/fileSends.ts`, unfriending in `lib/shareAccess.ts`, account deletion in
`routes/users.ts`). The inbox renders it with no buttons and the line "This file
expired. Ask bob to send it again." Guards: `lib/fileSendReaper.unit.test.ts`,
`__tests__/fileSends.test.ts`.

**An offer to download is WITHDRAWN, never left to fail.** Two guards, in that
order. The S3 lifecycle rule on `file-sends/` is deliberately one day longer
than `FILE_SEND_TTL_DAYS` (`infra/terraform/envs/prod/s3.tf` — raising the TTL
means raising the rule FIRST), so at day 7 the row expires and `inboxWhere`
drops the notification, its buttons and all, while the bytes are still there.
Belt to that braces: `POST /file-sends/:id/accept` HEADs the object before
signing a URL for it, and a definitively missing one (`isMissingObjectError` —
404/NotFound/NoSuchKey, never a throttle or a permission fault) sets
`expiresAt = now`. That one true fact retires the send for EVERY recipient
through the filters that already exist, and hands the sender's quota back. The
client then sees a 404, which `isResolvedElsewhereError` already treats as dead
rather than retryable, so the row clears instead of offering a button that
cannot work.

**A received file is answered in the INBOX, not on a page of its own.**
`screens/ReceivedFilesScreen.tsx` and its More row are deleted (2026-08-30): a
send is one accept/decline pair and an accepted file becomes an ordinary Saved
import, so it never needed a screen. Two rules hold the replacement together.
- **Which actions a notification carries, and every word of their copy, is
  `notifications/notificationActions.ts`** — a pure, RN-free module with its
  own test, exactly like `notifications/tapTarget.ts`. It covers BOTH actionable
  kinds (`friend_request` and `file_sent`); `NotificationsScreen` renders what
  it returns and knows nothing about friendships or sends. A third actionable
  kind is a branch there, not a screen.
- **Every decline confirms in a dialog, the friend request included** — even
  though web and `FriendsScreen` do not ask. On those surfaces decline sits
  behind an overflow sheet, which IS the "no is never a mis-tap away from yes"
  guard; side by side in a list row there is no sheet left to be it.

The accept pipeline itself is `imports/acceptReceivedFile.ts` (download to
scratch → `runGeoPdfImport` for a PDF, `importVectorSource` otherwise → delete
the scratch file), unchanged by the move and deliberately not the screen's
business.

**The recipient sees the FILENAME on the notification**, resolved at read time
in `api/src/routes/notifications.ts` from the live send — never denormalised
into the stored payload (PRIV-005), with ONE audited exception: when a send
expires unsaved, `lib/fileSendReaper.ts` stamps the filename into that
recipient's payload before deleting the last copy of it, so the row can still
say *which* file lapsed. Scoped as tightly as the exception allows — only
recipients who never took the copy (the ones who did have their notification
deleted instead), only at expiry, only that one field. Nothing else writes it. It is there because nobody can answer "keep this?" without knowing what is
on offer. That resolve step and `GET /file-sends/inbox` share ONE filter,
`inboxWhere` in `api/src/lib/fileSendAccess.ts`: anything the notification
admits that the inbox would not is a live Accept button whose endpoint answers
404. Guard: `api/src/__tests__/fileSends.test.ts`, "the actionable notification".

## Inbox (2026-08-30)

**A notification's read bit and its deletion are OUTBOX ops, not REST calls**
(`notification: ["markRead", "markUnread", "delete"]` in `shared/src/sync.ts`),
so the inbox is editable with no signal like everything else. Two consequences.
The read bit is no longer monotonic, so `planOutboxEnqueue` SUPERSEDES a queued
read-state op instead of deduping it (a read→unread→read fiddle must leave one
op, the last); guard: `shared/src/syncClient.test.ts`. And the server's
`applyNotificationOp` stays owner-scoped in the `where`, so a foreign id is
indistinguishable from a purged one — the same anti-oracle rule the REST routes
follow.

**A refetch must REPLAY the outbox over the server's answer**
(`pendingInboxOps` in `sync/notificationsCache.ts`). `GET /notifications` is the
authority on `read` and on what exists, so a fetch that ignored the queue undid
every pending change as it landed: a row marked read went back to saying New
(the race `patchCachedPayload` was invented for), and a row deleted offline came
back from the dead on the next pull-to-refresh. Every cache write also fires
`notifyMirrorChanged` — the patches used to and the fetch did not, which left
the tab badge on the old number after a refresh.

**The inbox is a WINDOW: `GET /notifications` caps at 500 and reports the true
total.** Nothing prunes notifications server-side, so a long-lived account will
pass it; past the cap the oldest are invisible to every client. The list says so
in a footer line (DESIGN.md), which is the honest minimum — the real fix is
retention (a reaper dropping read notifications older than N days) and is an
operator decision, not a code one. Note `PATCH /notifications/read-all` marks
EVERYTHING read, including rows past the cap; bulk delete only ever touches rows
the user can see.

**A row's border WIDTH must not change with its state, on any card in a list.**
Marking a notification read flipped `borderLeftWidth` 3 → 1 and the row rendered
as an EMPTY CARD — frame and background, no icon, no text — until something
forced a redraw. Fabric on Android re-derives the clip bounds of a rounded
`overflow: hidden` card from its border box and drops the children when it does.
Every notification row now declares the same 3pt left edge and only its COLOUR
says unread (`rowEdgeAccent` / `rowEdgeIdle`). Colour changes are free; widths
are not.

## Battery (field constraint — a flat phone is a navigation failure)

The 2026-08-17 pass. Every rule below is a rule because the code broke it. Where
a check exists it is named; the two that have none are marked, and both are
inside `MapScreen`'s effects, which nothing can reach without a renderer in the
test setup — the honest statement is that they are guarded by this file and by
review, not by CI.

- **A sensor runs only while the map tab is FOCUSED and the app is in the
  FOREGROUND.** `MapScreen` mounts once per process and in practice never
  unmounts, so nothing else ever stops one: a single locate-me tap used to leave
  a 3 s GPS watcher and the compass running for the life of the process, on
  other tabs and with the phone asleep in a pack. Both watchers are owned by
  effects keyed on `sensorsActive = mapFocused && appActive` — never by
  imperative start/stop helpers, which is how the old code ended up with four
  "am I already starting" flags that disagreed about whether the dot was on. The
  user's *intention* (`dotWanted`) is separate state from the subscription
  handle; anything asking "is the dot on" must read the intention. The RECORDER
  is exempt and must stay exempt: it is a foreground service and running in the
  background is its whole job. **No executable check** — see the note above.
- **The compass heading never goes back into a screen's state.** It lives in
  `map/heading.ts` behind `publishHeading`/`useLiveHeading` and is read by
  exactly two memoised components (`UserLocationMarker`, `LiveCompassStrip`).
  A component that only needs part of the heading subscribes to part of it:
  `useHasLiveHeading` (course-up draws the arrow at a constant, so the value is
  not on screen) and `useQuantisedLiveHeading` (the tape moves 2.2 px per
  degree and rebuilds ~30 native views per render, so a quarter-degree snapshot
  is half a pixel and `useSyncExternalStore` bails out of most renders). The
  sensor itself is gated on `userCoord`, not `dotWanted` — the arrow does not
  mount until there is a fix, and indoors that can be never.
  Course-up also draws the arrow VIEWPORT-aligned and pointing straight up
  (`lockUpright`), because in that mode the camera's rotation is a native ramp
  and `iconRotate` is a per-tick prop — two animators on one angle, which reads
  as the arrow twitching against a gliding map. Course-up additionally offsets
  the camera target FORWARD along the heading so the user sits three quarters
  down the screen (`povCameraCenter`, applied in `setCameraStop`); MapLibre's
  camera padding cannot be used for that, because Android only applies padding
  on a stop that carries a target, so it outlives the mode.
  In `MapScreen`'s `useState` every sample re-rendered the whole map — MLRN
  memoises none of its layer components and re-commits props per layer per
  render, and the Protomaps band alone is ~71 layers (more with saved regions).
  Anything else wanting the heading subscribes; it does not lift it back up.
  **No executable check** — see the note above.
- **A camera stop with no `easing` EASES, and that is a trap for
  anything continuous.** MLRN only sends a mode when you pass one, and the
  Android side then defaults to `CameraMode.EASE` →
  `easeCamera(update, duration, true)`, an accelerate-decelerate curve
  (`CameraUpdateItem.java`). A stream of those never leaves the slow opening of
  an ease it never finishes, so the map lurches once per stop — course-up read
  as one jump per camera write. Anything driven from a sensor at rate wants
  `easing: "linear"` (MLRN 10 spelled it `animationMode: "linearTo"` —
  `easeCamera(..., false)`, constant velocity) and
  a duration equal to the interval it is covering. One-shot moves — a recentre,
  a fit — are the case ease was built for; leave those alone.
  - **A second stop does not blend into the one in flight, it cancels it**
    (`Transform.easeCamera` calls `cancelTransitions()` first), so "make the
    animation longer so they overlap" does not smooth anything — with an ease
    curve it just restarts the slow opening, forever.
    - **So ONE writer owns the camera at a time, and its stop carries
      everything.** Course-up's heading ticker (bearing + centre, no zoom) and
      the double-tap zoom ramp (centre + zoom, no bearing) each ran on their own
      interval, and each cancelled the other mid-transition: the operator read
      it as "two mechanisms fighting", one zooming to the middle and one holding
      the marker in place. `startZoomRamp` is now the only writer while it runs
      — it carries the bearing `headingFilter.current.value` holds and records
      it in `lastPovBearing`, and `tickHeading` publishes the heading but writes
      no stop while `zoomRampTicker.current != null`, so the ticker resumes from
      the bearing the ramp last wrote instead of snapping. The duration rule is
      `povStopDurationMs` (heading.ts, `heading.test.ts`) — one implementation,
      because the ramp shipped with `duration: <its own interval>`, the exact
      no-headroom case `POV_ANIMATION_HEADROOM` exists to prevent.
  - **The display runs on its own clock, not the sensor's.** A sample moves a
    TARGET (`noteHeadingSample`); a fixed 31 Hz ticker in `MapScreen`
    (`tickHeading`) walks the shown bearing towards it, publishes it and writes
    the camera stop. Driving the camera straight off samples made every segment
    a different length and so a different angular velocity — the rotation
    visibly surged and sagged inside one turn. The ticker STOPS on arrival
    (`headingSettled`) and restarts on the next sample that moves the target,
    which is what replaces the old "a still phone writes nothing" deadband;
    `HEADING_TICK_MS` is the one knob for both the redraw and the camera rate.
  - **Still-phone noise is killed at the TARGET, by a drag follower, not by a
    gate.** `HEADING_HYSTERESIS_DEG` (2.5°) keeps the target within that much of
    the sample, so the 2.03° quantum the platform flips between while the phone
    lies still moves nothing at all, while a real turn drags the target
    continuously and never staircases (the ≥3° gate that did staircase is the
    thing this replaces). It costs a standing bias of up to 2.5°. Pinned by
    `heading.test.ts` ("holds a still phone perfectly still, and stops ticking",
    "drags rather than gates").
  - **The display TRACKS A RATE; it does not chase a position, and no
    position filter can do this job.** The input is a 2° staircase ~200 ms
    apart, so anything computing its output from the current position error
    answers every step with its own small acceleration — visible stutter, worst
    at slow turn rates, and damping it only buys lag. Both a plain exponential
    and (2026-08-17) a one-euro filter failed exactly there. `stepHeadingFilter`
    instead averages the rate implied by each target move
    (`HEADING_RATE_TAU_MS`), dead-reckons the display forward on it, and lets a
    deliberately SLOW position term (`HEADING_CATCHUP_TAU_MS`) mop up the drift
    — do not speed that one up, it is the term that can see the staircase.
    Dead reckoning's own failure is overshoot when the phone stops between
    samples, bounded by `HEADING_LEAD_DEG`/`HEADING_LEAD_MS` capping how far the
    display may lead the target — IN THE DIRECTION OF TRAVEL ONLY. Clamping a
    display that is BEHIND the target turns the cap into a snap; that bug and a
    stale-`dt` one (the first tick after the ticker had been stopped billed
    itself for the whole idle period, so the first movement of a rested phone
    lurched) were the two things actually behind "it jumps, then comes back".
    `HEADING_MAX_STEP_MS` bounds the second: this is an animation clock, and
    missing frames means drawing the frames you got, not covering the gap in
    one. Pinned by `heading.test.ts` ("turns at a CONSTANT rate, which is the
    whole point", measuring per-tick angular velocity ripple at 8/25/60°/s,
    "does not sail past a turn that stops", "does not follow one bad sample").
- **`expo-sensors` UNREGISTERS EVERY SENSOR WHEN THE ACTIVITY BACKGROUNDS**
  (`SensorProxy.kt:99`, `OnActivityEntersBackground { onHostPause() }`). So no
  sensor of any kind — barometer included — is reachable from JS during a
  recording, which is exactly when the data is interesting. The only way in is a
  native module registering against the SensorManager itself; worked example in
  `modules/logjam-sensors`, and it ships in developer builds only (see
  `plugins/withSensorLogging.js`).
- **The heading comes from `expo-sensors`' `DeviceMotion`, NOT
  `expo-location`'s `watchHeadingAsync`, and that swap fixed more than any
  filter did** (2026-08-17). `rotation.alpha` is Android's `TYPE_ROTATION_VECTOR`
  — gyro-fused — read at `HEADING_SENSOR_MS` (30 ms). `expo-location` registers
  bare `TYPE_ACCELEROMETER` + `TYPE_MAGNETIC_FIELD` at `SENSOR_DELAY_NORMAL`
  past a 2° / 50 ms gate (`LocationModule.kt:549-571`), hardcoded and not
  settable from JS: ~5 Hz in 2° steps, and — because the accelerometer cannot
  tell gravity from a hand accelerating — a genuinely BACKWARDS azimuth for a
  sample or two at the start of a real turn. No filter can remove that; the
  reading is wrong, not noisy. Two consequences to keep in mind:
  - The rotation vector is referenced to MAGNETIC north, so
    `headingFromDeviceRotation` always applies `NSW_MAGNETIC_DECLINATION_DEG`.
    We no longer get expo-location's `GeomagneticField`-derived true heading on
    the occasions it had a fix; the constant is worth ≤1° inside NSW.
  - It needs NO permission, so the compass tape and the arrow's bearing now work
    with location denied. `permissionNonce` existed only to re-check that
    permission and is gone.
  - `DeviceMotion` registers five sensors and we read one. Only while the map
    tab is focused and foregrounded, i.e. only with the screen lit. The upgrade
    path if that ever shows up in a field battery number: our own Expo module
    exposing `TYPE_ROTATION_VECTOR` alone.
- **The sensor's real cadence is MEASURED, and the constants are derived from
  the measurement — not from what we asked for.** `setUpdateInterval` is a
  dispatch throttle; the native registration rate is `SENSOR_DELAY_NORMAL`
  unless the app declares `HIGH_SAMPLING_RATE_SENSORS`
  (`SensorSubscription.kt:21-26`), which we deliberately do not — on a Pixel 9
  that permission means five sensors at 200 Hz for a compass that needs eight.
  Measured at rest over 35 s (`HDGPROBE`, 2026-08-17): **distinct readings every
  133 ms (8 Hz)**, and **0.053° peak-to-peak of wander**. Both numbers are
  load-bearing:
  - `HEADING_RATE_MAX_GAP_MS` was derived from `HEADING_SENSOR_MS` and landed at
    120 ms — *below* the 133 ms cadence — so it rejected nearly every rate
    measurement and the rate tracker was silently inert, leaving a pure position
    chaser with 320 ms of lag. It is a measured constant now. There is a floor
    too (`HEADING_RATE_MIN_GAP_MS`): a gap far shorter than the cadence is
    delivery jitter, and dividing a real angle by it manufactures a rate the
    display then dead-reckons off at.
  - Gaps are timed from `rotation.timestamp` (the sensor's own monotonic clock,
    converted once by `deviceSampleTimeMs`), NOT from arrival. Arrival timing
    quantises a 133 ms gap to the dispatch grid and puts ±25 % of noise into the
    one number the tracker integrates — and it is what forced a 30 ms dispatch.
    With sensor timing the dispatch can be 60 ms, halving bridge traffic that
    was ~22 duplicate events per second.
  - `HEADING_HYSTERESIS_DEG` is sized by HAND TREMOR, not sensor noise, and the
    "still phone stops the ticker" property is a CLIFF at exactly that value:
    duty cycle runs 0.2 % at ±1.0° of wander and 82 % at ±2.0°, because past the
    band the drag follower ratchets 1:1 and the display can never catch a target
    oscillating at sample rate. `heading.test.ts` ("stops ticking below the
    hysteresis, and only below it") pins both sides. Don't lower it without
    re-measuring on hardware.
- **A device with no gyroscope has no rotation vector, and must fall back.**
  `DeviceMotion` still dispatches (the accelerometer is universal) but never
  carries `rotation`, so the compass would simply never appear. The map waits
  `ROTATION_VECTOR_GRACE_MS` for a reading and then starts
  `watchHeadingAsync` instead. The fallback triggers on the ABSENCE OF DATA, not
  on `DeviceMotion.isAvailableAsync()`: that probe demands all five sensors,
  four of which the framework synthesises, so it can answer false on hardware
  that would have worked.
- **Overshoot is bounded by an absolute ceiling, not by a formula in the thing
  it bounds.** `HEADING_LEAD_DEG + rate × HEADING_LEAD_MS` had no ceiling, so
  the cap meant to limit overshoot grew with the rate it was limiting: a ~1000°/s
  wrist flick permitted 63° of lead and the map ran that far past the phone and
  crawled back. `HEADING_LEAD_MAX_DEG` (8°) caps it, the rate estimate itself is
  clamped to `HEADING_MAX_SLEW_DEG_PER_S` (a rate the display can never turn at
  is not something to predict on), and the stall multiple is 2 not 3 because
  that delay IS the overshoot. Pinned by `heading.test.ts` ("stays within a few
  degrees however hard the phone is turned"), which tests 200/400/700°/s —
  **the original "under 5°" was measured at 110°/s and did not generalise; test
  the flick, not the turn.**
- **Declination is derived, not assumed.** `expo-location` builds `trueHeading`
  as `magHeading + GeomagneticField.declination` (`LocationModule.kt:603-607`),
  so one `getHeadingAsync` and a subtraction give Android's own WMM value with
  no native module and no offline model (`learnDeclination`). Refreshed on
  TRAVEL (`declinationNeedsRefresh`, ~55 km) rather than on a timer, because
  declination is a function of position and drifts ~0.1°/year — a TTL would
  refresh a phone sitting in one valley all week and still miss a drive.
  `NSW_MAGNETIC_DECLINATION_DEG` is now only the pre-first-fix fallback and what
  a guest with location denied keeps using. Three traps in that path, all found
  by the 2026-08-17 accuracy audit and all now guarded:
  - **`trueHeading >= 0` is the wrong test.** `calcTrueNorth` is
    `(magNorth + declination) % 360` in Kotlin, whose `%` keeps the sign, so
    west of the agonic line the REAL answer is negative and `>= 0` reads it as
    the no-fix sentinel — pinning the app to the NSW constant exactly where it
    is most wrong. Only the exact `-1` is the sentinel (`hasTrueHeading`).
  - **`getHeadingAsync` can never resolve.** It waits for a sample with better
    than low accuracy, or six samples, and samples need 2° of movement — so a
    still phone holds an accel+magnetometer registration open indefinitely.
    `refreshDeclination` therefore allows only ONE outstanding read and records
    the position only on success, which is what makes retrying safe.
  - **The tape's magnetic mode must subtract what the forward path added.** It
    subtracted the NSW literal while `resolveTrueHeading` added the learned
    value; use `currentDeclinationDeg()`. One constant, one source.
- **The bearing pipeline was audited end to end on 2026-08-17 and is correct**
  — sign and reference frame through `getRotationMatrixFromVector` →
  `getOrientation` → `alpha` → our negation, declination sign and
  single-application on both call paths, and MapLibre's camera `heading` as
  degrees-clockwise with no unit or sign change from JS to `nativeEaseTo`. The
  rotation vector is MAGNETIC-referenced (MapLibre's own compass engine never
  touches `GeomagneticField`), so adding declination is right and is not a
  double correction. Total standing offset we contribute is **≤1.4°** (1.0° of
  hysteresis drag, which reverses with turn direction, plus ≤0.4° of constant
  before a declination is learned) — so a consistent one-directional offset in
  the field is a device or environment problem, not this code.
  - Two known gaps, deliberately not fixed: the display rotation in every
    `DeviceMotion` event is ignored (harmless under the portrait lock, silently
    90° wrong if that lock is ever lifted on a landscape-natural device), and
    past 90° of pitch the azimuth flips 180° (MapLibre's own engine re-remaps
    at ±45°; we do not). Tilt also amplifies orientation noise by 1/cos(pitch).
  - Whether a declination was learned is reported in Settings → Map, as the
    hint under "Compass bearings from" (`declinationHint`) — that control IS the
    difference between the two norths, so the number belongs there rather than
    in a row of its own, where it would read as a setting instead of a fact
    about where the user is standing.
- **A miscalibrated magnetometer is the one compass fault we cannot correct, so
  we say so.** Every app on the handset reads the same sensor, so "the other map
  app agrees" is not reassurance — three apps agreeing and all disagreeing with
  the terrain is the signature. `compassNeedsCalibration` drives a banner in the
  map's own notice stack whenever accuracy is LOW or UNRELIABLE.
  - **THE ACCURACY VALUE IS CONTAMINATED, and that is why the bar is set at
    UNRELIABLE rather than at LOW where Google Maps puts it.**
    `LocationModule.kt:851-853`'s `onAccuracyChanged` does not filter by sensor,
    and the same listener is registered for `TYPE_ACCELEROMETER` (`:557`) as
    well as `TYPE_MAGNETIC_FIELD` (`:551`) — so a heading sample's `accuracy` is
    whichever of the two last reported, and an accelerometer saying "low" is not
    a statement about the compass. Warning at LOW put a banner up while the
    system compass app reported HIGH. It cannot be separated from JS, so the
    only defence is to act on the one reading that is unambiguous.
  - **Confirmation is required to APPEAR and not to CLEAR**
    (`foldCompassProbe`, `COMPASS_BAD_PROBES_TO_WARN`). A warning slow to
    appear costs nothing — the compass was already wrong while we decided. One
    slow to GO is the actual bug: the user has just waved the phone in a figure
    of eight and is watching to see whether it worked. The probe cadence follows
    the same rule (`compassProbeIsUrgent`): seconds while a warning is up or
    being confirmed, two minutes otherwise.
  - **The accuracy is only reachable through `expo-location`.** `expo-sensors`
    discards it (`onAccuracyChanged` is `= Unit` in `DeviceMotionModule.kt` and
    `SensorProxy.kt`); expo-location keeps it (`LocationModule.kt:851-852`) and
    ships it on every heading event (`:583`). So it is SAMPLED in a 2 s probe
    every 2 min, not watched — leaving `watchHeadingAsync` running would
    re-register the magnetometer for the session, which is part of what the
    DeviceMotion swap bought back.
  - **The probe takes the BEST accuracy in its window, not the first.** Expo's
    `mAccuracy` starts at 0 (`unreliable`) and is only corrected when Android
    fires `onAccuracyChanged`, which can land after the first heading event — so
    a first-sample reading reports a false fault on a healthy compass.
  - **No reading is no information, in BOTH directions.** A still phone emits no
    heading events at all (2° gate), so silence must not raise a warning — or
    every user who sets their phone down gets a permanent banner — and must not
    clear one either, or a phone set down mid-fault quietly drops the banner
    while still pointing the wrong way. Pinned by `heading.test.ts` ("treats no
    reading as no information, in both directions").
  - It needs location permission, which the compass otherwise does not. Denied
    means no reading and no banner: the map is no worse off, it just cannot warn.
- **The accuracy flag cannot see the fault that actually bites, so there is a
  second check beside it.** Android's accuracy is CALIBRATION CONFIDENCE: the
  hub fits a sphere to recent magnetometer samples, centre = hard-iron offset,
  radius = local field strength, and reports how well-conditioned the fit is. A
  magnet held against the phone does not spoil that fit — it moves the sphere's
  centre — so once the calibrator re-converges it reports HIGH and the bearing
  is right again. The dangerous window is the one BEFORE it re-converges, where
  the compass is wrong and every indicator says fine. Verified in the field: a
  magnet threw the bearing ~90° while both our banner and the system compass app
  reported high accuracy.
  - The check that survives it is field STRENGTH, because direction has no known
    correct answer and magnitude does (`magneticInterference`): about 57 µT in
    NSW (`NSW_FIELD_STRENGTH_UT`), from `expo-sensors`' `Magnetometer` in the
    same probe window — one sensor, and NO location permission, unlike the
    accuracy probe beside it.
  - **The window keeps a min and a max, not an average**, because the second
    test is orientation-independence: a correct calibration reads the same
    strength whichever way the phone points, so a strength that SWINGS while the
    user turns is a fault even when every individual reading is plausible. That
    catches a disturbance whose magnitude happens to land in the band.
  - `FIELD_STRENGTH_TOLERANCE_UT` is provisional and deliberately generous —
    every false positive trains the user to ignore the banner. Tune it from the
    diagnostics line, not from arithmetic.
- **Settings → Map reports what the compass is actually doing**
  (`compassDiagnostics`, published by the map's probe through
  `publishCompassProbe`). None of this was observable before: "is my compass all
  right" had no answer on the device, which made every threshold above a guess
  and left a user with a wrong bearing no way to tell whether the app knew. Any
  future change to a compass threshold should be made from that line.
- **A backgrounded recorder appends points and nothing else.** Track stats are
  display-only, so they are recomputed while the app is in front of someone and
  on return to the foreground (`refreshTrackStats` / `refreshActiveTrackStats`),
  never in the headless task — it was a full read of the series plus O(points)
  of arithmetic per fix, all night, getting worse the longer the trip ran.
  `appendTrackPoints` therefore carries `pointCount` in its own transaction.
  Guarded by `trackRecorder.test.ts` ("a backgrounded recorder only writes
  points").
- **The `/users/me` cache is a privacy boundary, not just a battery one**
  (`api/apiFetch.ts`): 60 s, invalidated by any non-GET to that path and by
  `wipeAllLocalData`, which is what both sign-out (`App.tsx`) and a different
  user signing in (`useAuth.ts`) go through. `GET /users/me` also PROVISIONS the
  row on first sign-in, so a hit on the wrong side of an account change would
  skip creating the new account. Pinned by `api/apiFetch.test.ts`.
- **Nothing automatic may wake the radio from the background.** The sync backoff
  ladder only arms in the foreground (`syncEngine.ts`; `syncEngine.test.ts`
  pins it) — the foreground edge and the offline→online edge already recover
  it, and a ladder behind a dark screen is a wakeup every few minutes for a
  whole trip. Do NOT "improve" that retry by putting `canRunNow` in front of it:
  a metered-disallowed link would decline, nothing would re-arm it, and the sync
  status would promise a retry forever.
- **The recording fix rate (`recordingPreferences.ts`) defaults to `balanced`
  (30 s); the presets run `finest` 3 s / `detailed` 10 s / `balanced` 30 s /
  `batterySaver` 120 s.** Only `timeInterval` moves the power bill:
  `distanceInterval` and `deferredUpdatesInterval` are delivery filters, and the
  latter costs data loss on a kill. Note the honest limit — the map's own 3 s
  dot watcher is a second client of one fused provider, which serves both at the
  faster rate, so the setting governs the recording's cost only while the map is
  NOT on screen.
  - **`distanceInterval` is 0 in every preset, deliberately** (2026-08-20). It
    saved nothing (it is ANDed with the interval, so it only discarded fixes the
    GNSS engine had already been woken to produce) and it threw away the most
    informative fixes in the batch: a fix refused for being too close to the
    last one is the recorder WATCHING SOMEONE STAND STILL, and it is the only
    thing that separates a two-minute rest from two minutes of very slow walking
    once the gap between accepted points is long. Those refusals are now counted
    against the point they were measured against (`track_point.suppressedCount`
    / `stationaryMs`) and spent by `demonstratedStoppedMs` in
    `shared/src/trackStats.ts`. The same movement gate still runs in
    `rejectTrackFix`, adaptively, so nothing extra is stored.
  - **A "Track detail" change now reaches the recording in progress**
    (`applyRecordingOptionsToActiveTrack`). It did not before: the preference
    was written and `locationOptions()` was read only at start/resume, so the
    setting silently lied for the rest of the trip. Re-registering the same task
    is an options UPDATE, not a stop/start (`TaskService.registerTask` →
    `LocationTaskConsumer.setOptions`), so there is no window with no recorder
    in it — which a stop-then-start could leave permanently if the start
    refused. Pinned by `trackRecorder.test.ts`.
  - **The names moved under the rates on 2026-08-17, and `balanced` means
    something different either side of that.** The preference therefore lives
    under a NEW key (`recordingFixRateV2`) and the old one is translated on read
    by rate, never by name; `recordingPreferences.test.ts` pins every mapping.
    Any future renaming needs the same treatment.

## Privacy (design constraint — see root CLAUDE.md)

Going offline puts canyon coords/names **on the device**. Every stage's privacy
note is mandatory. Non-negotiables:

- All local data in **app-private storage, excluded from cloud backup**
  (`allowBackup=false` Android; `NSURLIsExcludedFromBackupKey` iOS data dirs).
- **App lock** (biometric/PIN) gates the whole UI whenever the user has it on —
  **unconditionally**, not only once downloads exist. The old data-armed condition
  was wrong on its own terms: the sync mirror holds canyon names and coordinates
  from the first sync after sign-in, so "nothing downloaded" never meant "nothing
  sensitive". The asymmetry stands: turning it OFF requires the device
  authenticator and fails closed, turning it on is free, and the pref is
  device-scoped (`src/offline/appLockPreference.ts`).
  - **It defaults to OFF, and an unreadable/absent pref reads as off** — an
    operator decision (2026-08-04) that knowingly departs from the fail-safe
    default in the privacy rules: a lock armed on a fresh install put a biometric
    prompt in front of every cold start and every return from the camera, and the
    field friction outweighed the guard. Don't "fix" this back to on without the
    operator; do keep the off-requires-auth asymmetry, which is what still makes
    the switch safe once raised.
- **Every on-disk store is declared in `offline/localStores.ts`, and nowhere else
  may name `documentDirectory`/`cacheDirectory`** (`localStores.test.ts` fails
  the build if one does). The producers import their directory from it and the
  wipe iterates `WIPED_DIRS`, so a new store cannot exist without joining the
  wipe — the same medicine `sync/mirrorSchema.ts` applies to mirror tables.
  Scratch files go in `SCRATCH_DIR` via `scratchFileUri()`, never loose in the
  cache directory.
- **The wipe stops the producers before it deletes.** `cancelAllRegionDownloads()`
  and `stopGeoPdfImportRun()` are awaited first: a job still running re-created
  the directory the wipe had deleted and re-inserted its `map_artifact` row (the
  departing user's bbox) after the wipe reported success, and their module-level
  state outlived sign-out. MapLibre's ambient tile cache is cleared there too
  (`OfflineManager.resetDatabase()`) — the z/x/y rows ARE the browsed area.
- **FLAG_SECURE follows the app-lock preference** (`applyScreenCapturePolicy()`,
  called on every toggle and at startup — it is per-process state). Not app-wide:
  screenshotting a map is a legitimate field workflow, and a user who declined
  the lock declined this with it.
- **One wipe path for account transitions:** `offline/wipeLocalData.ts`. Sign-out
  and a DIFFERENT user signing in both call it, and it clears `logjam.db`,
  `logjam-offline.db`, the MBTiles regions, the overlay bundles, the imports and
  the media cache. It deliberately spares `logjam-prefs.db` — theme, app lock and
  crash-report choices describe the handset, not the account, and clearing them
  would silently disarm a lock the owner turned on. Guest mode made this the
  privacy boundary between two users of one phone: don't add a wipe anywhere
  else, extend this one. (A guest *linking* keeps their data — they have no
  local identity, so the different-user comparison never fires.)
- **A dependency's manifest can add permissions you never declared.**
  `expo-sensors` declares `ACTIVITY_RECOGNITION` for a Pedometer this app never
  uses, and manifest merging put it in every build from the day the compass
  started using expo-sensors. Removing our own declaration is a no-op — a
  library's has to be BLOCKED (`tools:node="remove"`, as app.json already does
  for SYSTEM_ALERT_WINDOW; `plugins/withSensorLogging.js` does it for this one).
  Audit with `aapt2 dump permissions <apk>` on the BUILT artifact, never app.json.
- **No canyon names/coords in push payloads** — opaque IDs only; fetch details over
  the authed API on tap.
- Crash/error reporter scrubs coords/names (mirror `api/src/lib/logger.ts`) — wired
  from day one, before any reporter ships.
- No new public/unauth endpoints. Reuse the authed API + its 404-not-403 anti-oracle
  (surface "not found", never "exists but hidden").
- Region-of-interest bboxes stay off the server (SIXMaps client-direct; Protomaps
  clip endpoint must not log bboxes). The DEM download is on that same
  client-direct path — terrarium tiles come straight from S3 to the phone, so a
  saved area's coarse location is exposed to that host exactly as the SIX tiles
  already are, and to no one else. Reading them back afterwards leaves the
  device entirely. The tile-pyramid path contains **no**
  `apiFetch` — that absence is the privacy property, so keep it out of any new code
  on that path.

## Builds & distribution (EAS)

`eas.json` holds three profiles: `development` (dev-client APK, the Metro loop),
`preview` (standalone internal-distribution APK — bundled JS, no Metro, no cable;
this is how a phone gets tested away from the dev host) and `production` (AAB for
the Play track). `preview`/`production` point at the prod API.

**The repo is public, so eas.json carries only non-identifying config.** The
Cognito pool/client IDs and the Sentry DSN live as EAS environment variables
(`eas env:create --scope project --environment preview --name EXPO_PUBLIC_...`),
not in the committed file. `mobile/.env` is gitignored and **is not uploaded to
EAS** — a build missing those vars fails loudly at launch, because `config.ts`
throws on an absent API URL. Set the vars before the first cloud build.

**The shared-rebuild rule applies on the build machine too.** `shared/dist` is
gitignored, so it never reaches an EAS builder — and `@logjam/shared` resolves to
`dist/index.js`, so a build without it dies in the Bundle JavaScript phase with
an "unable to resolve" that looks like a mobile bug. `eas-build-post-install` in
`package.json` runs `npm ci && npm run build` in `../shared` to produce it. Don't
remove that hook, and don't "fix" it by committing `dist/`.

**A LOCAL release build must pass `SENTRY_DISABLE_AUTO_UPLOAD=true` itself.**
The flag lives in `eas.json`'s build profiles, so a cloud build inherits it and
`./gradlew :app:assembleRelease` on a dev box does not: the Sentry gradle task
runs, `sentry-cli` fails, and the build dies at
`createBundleReleaseJsAndAssets_SentryUpload` — long after the slow tasks, for a
step nothing needs. Prefix the command with the flag (this is also what the EAS
profiles do, so the artifact is identical).

**Sentry sourcemap upload is OFF** (`SENTRY_DISABLE_AUTO_UPLOAD=true` in the
build profiles). The Sentry Gradle plugin fails the build outright when it has no
org/project/auth token, and those need operator setup. Consequence: crash reports
from a release build arrive with minified Hermes frames — the reporter works, the
stack traces are close to unreadable. To turn it on: add `organization` + `project`
to the `@sentry/react-native` plugin config in `app.json`, put the Sentry auth
token in an EAS secret (`SENTRY_AUTH_TOKEN`, secret-visibility — it IS a real
credential, unlike the DSN), and drop the disable flag.

OTA: `expo-updates` is wired (`runtimeVersion` = `appVersion` policy, channel per
profile). JS-only fixes ship with `eas update --branch preview`; anything native
(a new Expo module, a plugin change) needs a fresh build, because the runtime
version moves with `app.json` `version`.

**Publish updates with `npm run update:preview` / `update:production`, not bare
`eas update`.** `--private-key-path` defaults to `private-key.pem` *in the
certificate's directory* — i.e. `certs/`, which is committed. The key lives in
the fully-gitignored `keys/` instead (a file-level exception inside a committed
directory is one typo away from publishing a signing key in a public repo), so
the path has to be passed every time; the scripts do it.

**OTA updates are code-signed, and the private key is not in this repo.**
`certs/certificate.pem` IS committed — it ships inside every build and is what
the client checks against. `keys/` is gitignored and holds the RSA private key;
it must also live in an EAS secret (`EXPO_UPDATES_PRIVATE_KEY`) so
`eas update --private-key-path` can sign. Without signing, every launch would run
whatever JS the Expo account served — the app's largest remote-code path, inside
the app lock and on top of the canyon mirror. Two consequences that bite later:
the certificate is embedded at BUILD time, so rotating it needs a new build and
reinstall, not an update; and **losing the private key means no OTA at all until
a fresh build ships a new certificate.** Back it up where you back up the
keystore.

**`version` lives in three places that must move together:** `app.json` `version`,
`package.json` `version`, and `CLIENT_SEMVER` in `src/config.ts` (the
`x-logjam-client` header the min-version lever reads). Android `versionCode` is
EAS-managed (`appVersionSource: "remote"` + `autoIncrement`) — don't hand-set it.

## Verify

- `npm run typecheck` + `npm run lint` gate every change (wire into CI alongside the
  other packages).
- **Date tests run under a non-Sydney TZ.** Dev, tests and users all sit in NSW,
  so a UTC-vs-local bucket bug is invisible here — the activity spark shipped
  wrong for ~10 h/day. Pin the zone in the test (see `logbook.test.ts`, which
  asserts under both Australia/Sydney and America/Los_Angeles).
- **Nothing in CI bundles.** `typecheck`, `lint` and vitest all passed on a tree
  Metro could not bundle at all (an unhoisted `babel-preset-expo` after the SDK
  54 bump — the app died at the dev launcher). A resolution or plugin break only
  shows up in a real bundle: `npx expo export --platform android`, or install the
  APK.
- Runtime verify: `npm run dev:android` (add `--emulator` for the AVD), then the
  screenshot loop via `adb exec-out screencap -p`; mock GPS via `adb emu geo fix`;
  Maestro flows in `e2e/`. iOS = EAS build + real device (no local iOS on the
  Linux dev host).
- **To read data off a build that behaves like a real one, the
  `withLocalDebuggableRelease` plugin sets `debuggable true` + `buildConfigField
  "boolean", "DEBUG", "false"` on `buildTypes.release` (when `LOGJAM_LOCAL_API=1`,
  which `build-local-apk.sh` sets).** A debug build loads its JS from Metro and
  dies silently on the first headless relaunch out of signal; a plain release
  build refuses `run-as`. The debuggable-release APK is both trip-safe and
  readable. `android/` is gitignored so it ships nowhere, and release signs with
  `signingConfigs.debug` — so local debug/release swaps PRESERVE on-device
  tracks, and only an EAS build (different keystore) forces an uninstall.
  **The `DEBUG=false` half is load-bearing, not cosmetic:** `debuggable true`
  flips `BuildConfig.DEBUG` (AGP keys it to the flag, not the build-type name),
  which makes `getUseDeveloperSupport()` true and sends expo-updates down the
  dev-client path — it never loads the embedded update, so every `require()`d
  asset resolves to an empty URI and a fresh install renders no labels, glyphs
  or location marker. See `plugins/withLocalDebuggableRelease.js` and
  `private/todo/local-release-asset.resolution.md`.
- **Reading the on-device mirror: copy the `-wal` file too.** `logjam.db` runs in
  WAL mode, so `adb exec-out run-as com.logjamnsw.mobile cat files/SQLite/logjam.db`
  alone gives a snapshot missing every recent commit — which reads as "the write
  didn't happen". Pull `logjam.db`, `logjam.db-wal` and `logjam.db-shm` together,
  or check the UI instead.
- **Inspecting a downloaded region:** pull it with
  `adb exec-out run-as com.logjamnsw.mobile cat files/offline/regions/<id>.mbtiles`
  and read it with `node:sqlite`. A FINISHED region has no WAL sidecar (finalize
  flips the journal to DELETE), so unlike `logjam.db` a bare `cat` is safe; an
  unfinished one is still WAL and needs the sidecars. Worth checking: the tile blob
  magic (`FFD8FF` JPEG / `89504E47` PNG — the cache is MIXED and `format=png` in
  the metadata is advisory), and that a known tile sits at the FLIPPED TMS row —
  storing the unflipped y renders the whole map mirrored.
- The biometric prompt is `FLAG_SECURE`: `screencap` of it is solid black. Confirm
  it appeared with `adb shell dumpsys window | grep mCurrentFocus` (look for
  `BiometricPrompt`), not with a screenshot.
- Field-only realities (real GPS, no-signal, battery day) are operator-tested — see
  the operator setup doc.
