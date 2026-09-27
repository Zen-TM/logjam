# 0012. Declination is learned from the platform; compass faults are warned about, not corrected

- **Date:** 2026-08-17
- **Status:** Accepted
- **Supersedes:** —

## Context

The rotation vector the heading comes from ([0011](0011-compass-heading-pipeline.md))
is MAGNETIC-referenced, so a true bearing needs a declination, and a
miscalibrated or disturbed magnetometer produces a wrong bearing no filter can
fix. Three traps in the declination path were found by the 2026-08-17 accuracy
audit.

## Decision

**Declination is derived, not assumed.** `expo-location` builds `trueHeading` as
`magHeading + GeomagneticField.declination` (`LocationModule.kt:603-607`), so one
`getHeadingAsync` and a subtraction give Android's own WMM value with no native
module and no offline model (`learnDeclination`). Refreshed on TRAVEL
(`declinationNeedsRefresh`, ~55 km) rather than on a timer, because declination
is a function of position and drifts ~0.1°/year — a TTL would refresh a phone
sitting in one valley all week and still miss a drive.
`NSW_MAGNETIC_DECLINATION_DEG` is now only the pre-first-fix fallback and what a
guest with location denied keeps using. The three traps, all now guarded:
- **`trueHeading >= 0` is the wrong test.** `calcTrueNorth` is
  `(magNorth + declination) % 360` in Kotlin, whose `%` keeps the sign, so west
  of the agonic line the REAL answer is negative and `>= 0` reads it as the
  no-fix sentinel — pinning the app to the NSW constant exactly where it is most
  wrong. Only the exact `-1` is the sentinel (`hasTrueHeading`).
- **`getHeadingAsync` can never resolve.** It waits for a sample with better
  than low accuracy, or six samples, and samples need 2° of movement — so a
  still phone holds an accel+magnetometer registration open indefinitely.
  `refreshDeclination` therefore allows only ONE outstanding read and records
  the position only on success, which is what makes retrying safe.
- **The tape's magnetic mode must subtract what the forward path added.** It
  subtracted the NSW literal while `resolveTrueHeading` added the learned value;
  use `currentDeclinationDeg()`. One constant, one source.

**The bearing pipeline was audited end to end on 2026-08-17 and is correct** —
sign and reference frame through `getRotationMatrixFromVector` →
`getOrientation` → `alpha` → our negation, declination sign and
single-application on both call paths, and MapLibre's camera `heading` as
degrees-clockwise with no unit or sign change from JS to `nativeEaseTo`. The
rotation vector is MAGNETIC-referenced (MapLibre's own compass engine never
touches `GeomagneticField`), so adding declination is right and is not a double
correction. Total standing offset we contribute is **≤1.4°** (1.0° of hysteresis
drag, which reverses with turn direction, plus ≤0.4° of constant before a
declination is learned) — so a consistent one-directional offset in the field is
a device or environment problem, not this code.
- Whether a declination was learned is reported in Settings → Map, as the hint
  under "Compass bearings from" (`declinationHint`) — that control IS the
  difference between the two norths, so the number belongs there rather than in
  a row of its own, where it would read as a setting instead of a fact about
  where the user is standing.

**A miscalibrated magnetometer is the one compass fault we cannot correct, so we
say so.** Every app on the handset reads the same sensor, so "the other map app
agrees" is not reassurance — three apps agreeing and all disagreeing with the
terrain is the signature. `compassNeedsCalibration` drives a banner in the map's
own notice stack whenever accuracy is LOW or UNRELIABLE.
- **THE ACCURACY VALUE IS CONTAMINATED, and that is why the bar is set at
  UNRELIABLE rather than at LOW where Google Maps puts it.**
  `LocationModule.kt:851-853`'s `onAccuracyChanged` does not filter by sensor,
  and the same listener is registered for `TYPE_ACCELEROMETER` (`:557`) as well
  as `TYPE_MAGNETIC_FIELD` (`:551`) — so a heading sample's `accuracy` is
  whichever of the two last reported, and an accelerometer saying "low" is not a
  statement about the compass. Warning at LOW put a banner up while the system
  compass app reported HIGH. It cannot be separated from JS, so the only defence
  is to act on the one reading that is unambiguous.
- **Confirmation is required to APPEAR and not to CLEAR** (`foldCompassProbe`,
  `COMPASS_BAD_PROBES_TO_WARN`). A warning slow to appear costs nothing — the
  compass was already wrong while we decided. One slow to GO is the actual bug:
  the user has just waved the phone in a figure of eight and is watching to see
  whether it worked. The probe cadence follows the same rule
  (`compassProbeIsUrgent`): seconds while a warning is up or being confirmed, two
  minutes otherwise.
- **The accuracy is only reachable through `expo-location`.** `expo-sensors`
  discards it (`onAccuracyChanged` is `= Unit` in `DeviceMotionModule.kt` and
  `SensorProxy.kt`); expo-location keeps it (`LocationModule.kt:851-852`) and
  ships it on every heading event (`:583`). So it is SAMPLED in a 2 s probe every
  2 min, not watched — leaving `watchHeadingAsync` running would re-register the
  magnetometer for the session, which is part of what the DeviceMotion swap
  bought back.
- **The probe takes the BEST accuracy in its window, not the first.** Expo's
  `mAccuracy` starts at 0 (`unreliable`) and is only corrected when Android fires
  `onAccuracyChanged`, which can land after the first heading event — so a
  first-sample reading reports a false fault on a healthy compass.
- **No reading is no information, in BOTH directions.** A still phone emits no
  heading events at all (2° gate), so silence must not raise a warning — or
  every user who sets their phone down gets a permanent banner — and must not
  clear one either, or a phone set down mid-fault quietly drops the banner while
  still pointing the wrong way. Pinned by `heading.test.ts` ("treats no reading
  as no information, in both directions").
- It needs location permission, which the compass otherwise does not. Denied
  means no reading and no banner: the map is no worse off, it just cannot warn.

**The accuracy flag cannot see the fault that actually bites, so there is a
second check beside it.** Android's accuracy is CALIBRATION CONFIDENCE: the hub
fits a sphere to recent magnetometer samples, centre = hard-iron offset, radius
= local field strength, and reports how well-conditioned the fit is. A magnet
held against the phone does not spoil that fit — it moves the sphere's centre —
so once the calibrator re-converges it reports HIGH and the bearing is right
again. The dangerous window is the one BEFORE it re-converges, where the compass
is wrong and every indicator says fine. Verified in the field: a magnet threw
the bearing ~90° while both our banner and the system compass app reported high
accuracy.
- The check that survives it is field STRENGTH, because direction has no known
  correct answer and magnitude does (`magneticInterference`): about 57 µT in NSW
  (`NSW_FIELD_STRENGTH_UT`), from `expo-sensors`' `Magnetometer` in the same
  probe window — one sensor, and NO location permission, unlike the accuracy
  probe beside it.
- **The window keeps a min and a max, not an average**, because the second test
  is orientation-independence: a correct calibration reads the same strength
  whichever way the phone points, so a strength that SWINGS while the user turns
  is a fault even when every individual reading is plausible. That catches a
  disturbance whose magnitude happens to land in the band.
- `FIELD_STRENGTH_TOLERANCE_UT` is provisional and deliberately generous — every
  false positive trains the user to ignore the banner. Tune it from the
  diagnostics line, not from arithmetic.

**Settings → Map reports what the compass is actually doing**
(`compassDiagnostics`, published by the map's probe through
`publishCompassProbe`). None of this was observable before: "is my compass all
right" had no answer on the device, which made every threshold above a guess and
left a user with a wrong bearing no way to tell whether the app knew. Any future
change to a compass threshold should be made from that line.

## Consequences

- **Positive:** declination follows the user; a disturbed compass is reported.
- **Negative:** two known gaps, deliberately not fixed: the display rotation in
  every `DeviceMotion` event is ignored (harmless under the portrait lock,
  silently 90° wrong if that lock is ever lifted on a landscape-natural device),
  and past 90° of pitch the azimuth flips 180° (MapLibre's own engine re-remaps
  at ±45°; we do not). Tilt also amplifies orientation noise by 1/cos(pitch).
- **Neutral:** `FIELD_STRENGTH_TOLERANCE_UT` is provisional.

## Alternatives considered

- A fixed NSW declination constant: kept only as the pre-first-fix fallback.
- A declination TTL: rejected in favour of refresh on travel.
- Warning at LOW accuracy (where Google Maps puts it): rejected, the value is
  contaminated by the accelerometer.
- Watching `watchHeadingAsync` for accuracy: rejected, it would re-register the
  magnetometer for the session.
