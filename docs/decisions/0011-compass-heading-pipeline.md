# 0011. Compass heading: gyro-fused source, one camera writer, a rate-tracking display

- **Date:** 2026-08-17
- **Status:** Accepted
- **Supersedes:** —

## Context

Three rounds of filter work on the compass (2026-08-17) went into compensating
for a sensor stream that had no gyroscope in it. Course-up read as one jump per
camera write, turns surged and sagged, and the arrow jumped then came back.

**`expo-sensors` UNREGISTERS EVERY SENSOR WHEN THE ACTIVITY BACKGROUNDS**
(`SensorProxy.kt:99`, `OnActivityEntersBackground { onHostPause() }`). So no
sensor of any kind — barometer included — is reachable from JS during a
recording, which is exactly when the data is interesting. The only way in is a
native module registering against the SensorManager itself; worked example in
`modules/logjam-sensors`, and it ships in developer builds only (see
`plugins/withSensorLogging.js`).

## Decision

### Camera stops

**A camera stop with no `easing` EASES, and that is a trap for anything
continuous.** MLRN only sends a mode when you pass one, and the Android side then
defaults to `CameraMode.EASE` → `easeCamera(update, duration, true)`, an
accelerate-decelerate curve (`CameraUpdateItem.java`). A stream of those never
leaves the slow opening of an ease it never finishes, so the map lurches once
per stop. Anything driven from a sensor at rate wants `easing: "linear"` (MLRN 10
spelled it `animationMode: "linearTo"` — `easeCamera(..., false)`, constant
velocity) and a duration equal to the interval it is covering. One-shot moves —
a recentre, a fit — are the case ease was built for; leave those alone.
- **A second stop does not blend into the one in flight, it cancels it**
  (`Transform.easeCamera` calls `cancelTransitions()` first), so "make the
  animation longer so they overlap" does not smooth anything — with an ease
  curve it just restarts the slow opening, forever.
- **So ONE writer owns the camera at a time, and its stop carries everything.**
  Course-up's heading ticker (bearing + centre, no zoom) and the double-tap zoom
  ramp (centre + zoom, no bearing) each ran on their own interval, and each
  cancelled the other mid-transition: the operator read it as "two mechanisms
  fighting", one zooming to the middle and one holding the marker in place.
  `startZoomRamp` is now the only writer while it runs — it carries the bearing
  `headingFilter.current.value` holds and records it in `lastPovBearing`, and
  `tickHeading` publishes the heading but writes no stop while
  `zoomRampTicker.current != null`, so the ticker resumes from the bearing the
  ramp last wrote instead of snapping. The duration rule is `povStopDurationMs`
  (heading.ts, `heading.test.ts`) — one implementation, because the ramp shipped
  with `duration: <its own interval>`, the exact no-headroom case
  `POV_ANIMATION_HEADROOM` exists to prevent.

### The display

**The display runs on its own clock, not the sensor's.** A sample moves a TARGET
(`noteHeadingSample`); a fixed 31 Hz ticker in `MapScreen` (`tickHeading`) walks
the shown bearing towards it, publishes it and writes the camera stop. Driving
the camera straight off samples made every segment a different length and so a
different angular velocity — the rotation visibly surged and sagged inside one
turn. The ticker STOPS on arrival (`headingSettled`) and restarts on the next
sample that moves the target, which is what replaces the old "a still phone
writes nothing" deadband; `HEADING_TICK_MS` is the one knob for both the redraw
and the camera rate.

**Still-phone noise is killed at the TARGET, by a drag follower, not by a
gate.** `HEADING_HYSTERESIS_DEG` (2.5°) keeps the target within that much of the
sample, so the 2.03° quantum the platform flips between while the phone lies
still moves nothing at all, while a real turn drags the target continuously and
never staircases (the ≥3° gate that did staircase is the thing this replaces).
It costs a standing bias of up to 2.5°. Pinned by `heading.test.ts` ("holds a
still phone perfectly still, and stops ticking", "drags rather than gates").

**The display TRACKS A RATE; it does not chase a position, and no position
filter can do this job.** The input is a 2° staircase ~200 ms apart, so anything
computing its output from the current position error answers every step with
its own small acceleration — visible stutter, worst at slow turn rates, and
damping it only buys lag. `stepHeadingFilter` instead averages the rate implied
by each target move (`HEADING_RATE_TAU_MS`), dead-reckons the display forward on
it, and lets a deliberately SLOW position term (`HEADING_CATCHUP_TAU_MS`) mop up
the drift — do not speed that one up, it is the term that can see the
staircase. Dead reckoning's own failure is overshoot when the phone stops
between samples, bounded by `HEADING_LEAD_DEG`/`HEADING_LEAD_MS` capping how far
the display may lead the target — IN THE DIRECTION OF TRAVEL ONLY. Clamping a
display that is BEHIND the target turns the cap into a snap; that bug and a
stale-`dt` one (the first tick after the ticker had been stopped billed itself
for the whole idle period, so the first movement of a rested phone lurched) were
the two things actually behind "it jumps, then comes back".
`HEADING_MAX_STEP_MS` bounds the second: this is an animation clock, and missing
frames means drawing the frames you got, not covering the gap in one. Pinned by
`heading.test.ts` ("turns at a CONSTANT rate, which is the whole point",
measuring per-tick angular velocity ripple at 8/25/60°/s, "does not sail past a
turn that stops", "does not follow one bad sample").

**Overshoot is bounded by an absolute ceiling, not by a formula in the thing it
bounds.** `HEADING_LEAD_DEG + rate × HEADING_LEAD_MS` had no ceiling, so the cap
meant to limit overshoot grew with the rate it was limiting: a ~1000°/s wrist
flick permitted 63° of lead and the map ran that far past the phone and crawled
back. `HEADING_LEAD_MAX_DEG` (8°) caps it, the rate estimate itself is clamped to
`HEADING_MAX_SLEW_DEG_PER_S` (a rate the display can never turn at is not
something to predict on), and the stall multiple is 2 not 3 because that delay
IS the overshoot. Pinned by `heading.test.ts` ("stays within a few degrees
however hard the phone is turned"), which tests 200/400/700°/s — **the original
"under 5°" was measured at 110°/s and did not generalise; test the flick, not
the turn.**

### The source

**The heading comes from `expo-sensors`' `DeviceMotion`, NOT `expo-location`'s
`watchHeadingAsync`, and that swap fixed more than any filter did**
(2026-08-17). `rotation.alpha` is Android's `TYPE_ROTATION_VECTOR` — gyro-fused
— read at `HEADING_SENSOR_MS` (30 ms). `expo-location` registers bare
`TYPE_ACCELEROMETER` + `TYPE_MAGNETIC_FIELD` at `SENSOR_DELAY_NORMAL` past a
2° / 50 ms gate (`LocationModule.kt:549-571`), hardcoded and not settable from
JS: ~5 Hz in 2° steps, and — because the accelerometer cannot tell gravity from
a hand accelerating — a genuinely BACKWARDS azimuth for a sample or two at the
start of a real turn. No filter can remove that; the reading is wrong, not
noisy. Consequences to keep in mind:
- The rotation vector is referenced to MAGNETIC north, so
  `headingFromDeviceRotation` always applies `NSW_MAGNETIC_DECLINATION_DEG`. We
  no longer get expo-location's `GeomagneticField`-derived true heading on the
  occasions it had a fix; the constant is worth ≤1° inside NSW.
- It needs NO permission, so the compass tape and the arrow's bearing now work
  with location denied. `permissionNonce` existed only to re-check that
  permission and is gone.
- `DeviceMotion` registers five sensors and we read one. Only while the map tab
  is focused and foregrounded, i.e. only with the screen lit.

**The sensor's real cadence is MEASURED, and the constants are derived from the
measurement — not from what we asked for.** `setUpdateInterval` is a dispatch
throttle; the native registration rate is `SENSOR_DELAY_NORMAL` unless the app
declares `HIGH_SAMPLING_RATE_SENSORS` (`SensorSubscription.kt:21-26`), which we
deliberately do not — on a Pixel 9 that permission means five sensors at 200 Hz
for a compass that needs eight. Measured at rest over 35 s (`HDGPROBE`,
2026-08-17): **distinct readings every 133 ms (8 Hz)**, and **0.053°
peak-to-peak of wander**. Both numbers are load-bearing:
- `HEADING_RATE_MAX_GAP_MS` was derived from `HEADING_SENSOR_MS` and landed at
  120 ms — *below* the 133 ms cadence — so it rejected nearly every rate
  measurement and the rate tracker was silently inert, leaving a pure position
  chaser with 320 ms of lag. It is a measured constant now. There is a floor too
  (`HEADING_RATE_MIN_GAP_MS`): a gap far shorter than the cadence is delivery
  jitter, and dividing a real angle by it manufactures a rate the display then
  dead-reckons off at.
- Gaps are timed from `rotation.timestamp` (the sensor's own monotonic clock,
  converted once by `deviceSampleTimeMs`), NOT from arrival. Arrival timing
  quantises a 133 ms gap to the dispatch grid and puts ±25 % of noise into the
  one number the tracker integrates — and it is what forced a 30 ms dispatch.
  With sensor timing the dispatch can be 60 ms, halving bridge traffic that was
  ~22 duplicate events per second.
- `HEADING_HYSTERESIS_DEG` is sized by HAND TREMOR, not sensor noise, and the
  "still phone stops the ticker" property is a CLIFF at exactly that value: duty
  cycle runs 0.2 % at ±1.0° of wander and 82 % at ±2.0°, because past the band
  the drag follower ratchets 1:1 and the display can never catch a target
  oscillating at sample rate. `heading.test.ts` ("stops ticking below the
  hysteresis, and only below it") pins both sides. Don't lower it without
  re-measuring on hardware.

**A device with no gyroscope has no rotation vector, and must fall back.**
`DeviceMotion` still dispatches (the accelerometer is universal) but never
carries `rotation`, so the compass would simply never appear. The map waits
`ROTATION_VECTOR_GRACE_MS` for a reading and then starts `watchHeadingAsync`
instead. The fallback triggers on the ABSENCE OF DATA, not on
`DeviceMotion.isAvailableAsync()`: that probe demands all five sensors, four of
which the framework synthesises, so it can answer false on hardware that would
have worked.

## Consequences

- **Positive:** the display turns at a constant rate; the compass works with
  location permission denied.
- **Negative:** a standing bias of up to 2.5° from the hysteresis; `DeviceMotion`
  registers five sensors to read one.
- **Neutral:** Not recorded.

## Alternatives considered

- `expo-location`'s `watchHeadingAsync` as the primary source: rejected (bare
  accel + magnetometer, backwards azimuth at the start of a turn); kept only as
  the no-gyroscope fallback.
- A plain exponential and (2026-08-17) a one-euro filter: both failed exactly
  at slow turn rates.
- A ≥3° gate for still-phone noise: it staircased; replaced by the drag follower.
- Declaring `HIGH_SAMPLING_RATE_SENSORS`: rejected, five sensors at 200 Hz.
- `DeviceMotion.isAvailableAsync()` as the fallback trigger: can answer false on
  working hardware.
- Upgrade path if `DeviceMotion`'s cost ever shows up in a field battery number:
  our own Expo module exposing `TYPE_ROTATION_VECTOR` alone.
