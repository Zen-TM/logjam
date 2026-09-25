# 0044. Track recording: fix-rate presets, and a boost to `finest` while the map is looked at

- **Date:** 2026-08-17
- **Status:** Accepted
- **Supersedes:** —

## Context

The recorder is a foreground service that runs with the screen off for a whole
trip, so its fix rate is the largest battery lever in the app. Its behaviour was
settled in the 2026-08-17 battery pass and amended on 2026-08-20 and
2026-09-13, as recorded below.

## Decision

**The recording fix rate (`recordingPreferences.ts`) defaults to `balanced`
(30 s); the presets run `finest` 3 s / `detailed` 10 s / `balanced` 30 s /
`batterySaver` 120 s.** Only `timeInterval` moves the power bill:
`distanceInterval` and `deferredUpdatesInterval` are delivery filters, and the
latter costs data loss on a kill. The setting governs the recording only while
the map is NOT on screen.

**While the map is looked at, the recorder is BOOSTED to `finest`
(2026-09-13), because the map's watcher does not speed it up.** The agent file
used to say the fused provider serves concurrent clients at the fastest rate any
of them asked for. It does not here: expo-location builds every request with
`setMinUpdateIntervalMillis` equal to its interval
(`LocationHelpers.prepareLocationRequest`), a per-client delivery ceiling. So at
the 30 s default the dot moved every 3 s while the recorder was WITHHELD those
fixes, and under a canyon wall — sky in 5-10 s windows — the track drew a live
tail to the dot with no anchor behind it. `setRecordingMapFocusBoost` is driven
by the same `sensorsActive` as the dot watcher, so screen off or tab left means
back to the user's rate.

**Screen off only works because of a NATIVE PATCH** — the repo's first,
`patches/expo-location+19.0.8.patch`, applied by `postinstall` (patch-package).
Stock expo-location refuses `startLocationUpdatesAsync` with a
`foregroundService` once the activity has paused, and its flag flips at the same
moment React Native emits `background`, so JS always loses: on a Pixel, Home
with the map open left the recorder at 3 s with
`ForegroundServiceStartNotAllowedException` in Metro. The patch exempts an
update to an already-registered task, which starts no service. **Re-check it on
every expo-location upgrade** — patch-package fails the install when it stops
applying, and `src/tracks/expoLocationPatch.test.ts` fails when the installed
copy lacks it. Native, so it needs a dev-client rebuild.

**A patch to an Expo module's Kotlin does NOTHING unless that module is built
from source.** SDK 54 modules ship a precompiled AAR
(`node_modules/<pkg>/local-maven-repo/`) and Gradle links it by default — the
build log marks those modules with 📦. The first patched dev client compiled
clean, installed, and refused the unboost exactly as before.
`expo.autolinking.android.buildFromSource: ["expo-location"]` in `package.json`
is the other half of the patch; the guard test checks both.

Two rules in the boost: the flag describes the SCREEN, not the recording, so it
survives pause/resume (resuming on the map must come back boosted, and nothing
re-fires the map's effect); and `reconcileTrackRecording` compares the
platform's persisted task options against what the process wants, because a
process that dies boosted leaves FLP delivering at 3 s with nothing left to turn
it down. Anchor placement is untouched — `rejectTrackFix` still decides by
displacement, never by time. Guard: `trackRecorder.test.ts`, "the map boost"
(the effect itself has no executable check, like the other `MapScreen` lifecycle
effects in [0040](0040-map-sensors-only-while-focused.md)).

**`distanceInterval` is 0 in every preset, deliberately** (2026-08-20). It saved
nothing (it is ANDed with the interval, so it only discarded fixes the GNSS
engine had already been woken to produce) and it threw away the most
informative fixes in the batch: a fix refused for being too close to the last
one is the recorder WATCHING SOMEONE STAND STILL, and it is the only thing that
separates a two-minute rest from two minutes of very slow walking once the gap
between accepted points is long. Those refusals are now counted against the
point they were measured against (`track_point.suppressedCount` /
`stationaryMs`) and spent by `demonstratedStoppedMs` in
`shared/src/trackStats.ts`. The same movement gate still runs in
`rejectTrackFix`, adaptively, so nothing extra is stored.

**A "Track detail" change now reaches the recording in progress**
(`applyRecordingOptionsToActiveTrack`). It did not before: the preference was
written and `locationOptions()` was read only at start/resume, so the setting
silently lied for the rest of the trip. Re-registering the same task is an
options UPDATE, not a stop/start (`TaskService.registerTask` →
`LocationTaskConsumer.setOptions`), so there is no window with no recorder in
it — which a stop-then-start could leave permanently if the start refused.
Pinned by `trackRecorder.test.ts`.

**The names moved under the rates on 2026-08-17, and `balanced` means something
different either side of that.** The preference therefore lives under a NEW key
(`recordingFixRateV2`) and the old one is translated on read by rate, never by
name; `recordingPreferences.test.ts` pins every mapping. Any future renaming
needs the same treatment.

## Consequences

- **Positive:** the track keeps up with the dot while the map is on screen.
- **Negative:** a patched, source-built native dependency that must be
  re-checked on every expo-location upgrade.
- **Neutral:** Not recorded.

## Alternatives considered

- Relying on the fused provider to serve the fastest concurrent rate: it does
  not, because of `setMinUpdateIntervalMillis`.
- A non-zero `distanceInterval`: rejected (2026-08-20), see above.
- Stop-then-start to apply a changed preference: rejected, it could leave no
  recorder if the start refused.
