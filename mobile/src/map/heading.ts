// Compass-heading smoothing.
//
// WHERE THE HEADING COMES FROM, because every constant below is shaped by it:
// `expo-sensors`' `DeviceMotion`, whose `rotation.alpha` is Android's
// **`TYPE_ROTATION_VECTOR`** run through `getRotationMatrixFromVector` +
// `getOrientation` (`DeviceMotionModule.kt`). That is the GYRO-FUSED
// orientation: the gyroscope supplies the motion, the accelerometer and
// magnetometer only correct its drift.
//
// IT IS NOT `expo-location`'s `watchHeadingAsync`, AND THAT SWAP FIXED MORE
// THAN ANY FILTER DID. `LocationModule.kt:549-557` registers bare
// `TYPE_ACCELEROMETER` + `TYPE_MAGNETIC_FIELD` at `SENSOR_DELAY_NORMAL` —
// hardcoded, not settable from JS — and emits only past a 2° / 50 ms gate. Two
// consequences, both of which were visible on the map:
//   - ~5 samples a second, in steps of at least 2°. A 300°/s wrist flick moves
//     60° between samples, so a fast turn could only ever be guessed at.
//   - NO GYROSCOPE. The accelerometer is what tells `getRotationMatrix` which
//     way is down, and it cannot tell gravity from a hand accelerating. Picking
//     the phone up and starting to turn produced a genuinely WRONG azimuth for
//     a sample or two, often in the opposite direction — the reported bearing
//     really did go backwards, so no amount of filtering could have removed it.
// The rotation vector has neither problem, and runs at whatever rate we ask.
//
// The stream is still not perfect — it arrives at HEADING_SENSOR_MS on a best
// effort, and the magnetometer's own drift means a still phone still wanders a
// fraction of a degree — so the smoothing below stays. It is simply no longer
// being asked to invent information that was never sampled.
//
// THE DISPLAY IS NOT SAMPLE-DRIVEN. A sample only moves a TARGET; a fixed-rate
// ticker (HEADING_TICK_MS, owned by MapScreen) walks the displayed bearing
// towards it. That inversion is what fixes the two remaining complaints at
// once: the on-screen motion no longer inherits the sensor's irregular cadence
// (a camera segment is always the same length, so the angular velocity stops
// surging and sagging between samples), and the tape and the map are driven off
// the same tick, so they agree.
//
// AND IT DOES NOT CHASE THE TARGET'S POSITION, IT TRACKS ITS RATE. That is the
// difference between "smoother" and smooth, and it is worth being precise about
// why, because two low-pass designs were tried here first and both failed the
// same way.
//
// The input is a 2° staircase arriving every ~200 ms. ANY filter that computes
// its output from the current position error reproduces that staircase: each
// step is an impulse, the output answers it with an exponential rise, and what
// you see is a series of little accelerations — fast just after a sample, dying
// away just before the next. Damp it enough to hide that and you have simply
// bought lag. There is no setting of a position filter that is both; a one-euro
// filter (which was the previous attempt) only moves the compromise around, and
// on a slow turn it still ran at ±90 % of the mean rate.
//
// So the display integrates a VELOCITY instead. Each target move gives an
// instantaneous rate (degrees moved ÷ the real gap); those are averaged with a
// long time constant (HEADING_RATE_TAU_MS) into an estimate that a 2° staircase
// barely perturbs, because every step of a steady turn implies the same rate.
// The displayed bearing then dead-reckons forward at that rate, and a SLOW
// position term (HEADING_CATCHUP_TAU_MS) only corrects the accumulated drift.
// On a steady turn the output is a constant angular velocity — the staircase
// disappears entirely rather than being smeared. Measured against the same
// simulated 25°/s turn: ±3.5°/s of ripple, where the one-euro filter gave
// ±16.3°/s.
//
// Dead reckoning's own failure mode is overshoot: the phone stops and the
// display keeps going until the next sample proves it. HEADING_LEAD_DEG /
// HEADING_LEAD_MS bound that directly, by capping how far the display may ever
// get AHEAD of the target — which turns an unbounded overshoot into a known few
// degrees, and costs nothing while a turn is actually running.
//
// A ceiling on displayed turn rate (HEADING_MAX_SLEW_DEG_PER_S) still sits
// after it, to turn a sensor spike into a drift rather than a snap.
//
// Gating was tried first and is worse: ignoring changes under 3° removed the
// small wobble and kept the big one, so the arrow sat still and then jumped.
//
// The live value lives at the bottom of this file, OUTSIDE React state, for
// battery: see `publishHeading`.
import { useSyncExternalStore } from "react";

import { metersPerPixel } from "./scaleBar";

/**
 * The animation cadence: how often the displayed bearing is advanced, published
 * to the arrow and the tape, and (in course-up) written to the camera.
 *
 * ~31 Hz. It is deliberately faster than the sensor, because it is not
 * reporting samples — it is drawing the motion between them. The camera stop it
 * produces animates linearly over one tick, so the native side fills in the
 * frames and the map moves at a genuinely constant rate.
 *
 * The ticker STOPS as soon as the display has settled on the target
 * (HEADING_SETTLED_DEG) and is restarted by the next sample that moves it, so a
 * phone held still costs nothing — same requirement the old deadband met.
 */
export const HEADING_TICK_MS = 32;

/**
 * How often `DeviceMotion` is asked to DISPATCH, in ms. It is not the rate the
 * orientation actually changes at, and the difference matters.
 *
 * MEASURED ON A PIXEL 9 (2026-08-17, `HDGPROBE` log over 35 s at rest):
 * dispatches arrive at the interval asked for, but distinct `rotation` values
 * arrive at **8 Hz — a 133 ms median gap**. `setUpdateInterval` is a dispatch
 * throttle only; the native registration rate is chosen in
 * `SensorSubscription.kt:21-26` and is `SENSOR_DELAY_NORMAL` unless the app
 * declares `HIGH_SAMPLING_RATE_SENSORS`, which we deliberately do not — on this
 * device that permission would mean five sensors at 200 Hz (`dumpsys
 * sensorservice`: rotation vector maxRate 200 Hz) for a compass that needs
 * about eight. There is no middle setting reachable from JS.
 *
 * So this is set to comfortably beat the data rate and no more. At 30 ms it
 * was, and 22 of every 30 dispatches carried a byte-identical bearing across
 * the bridge; 60 ms halves that traffic and still cannot miss a value.
 * TIMING IS NOT LOST BY SLOWING IT DOWN, because gaps are measured from the
 * sensor's own timestamp (`deviceSampleTimeMs`) rather than from arrival.
 *
 * ponytail: `DeviceMotion` registers five sensors (gyro, accel, linear accel,
 * rotation vector, gravity) and we read one. That is the price of not writing a
 * native module; the upgrade path, if a field battery day ever objects, is our
 * own Expo module exposing `TYPE_ROTATION_VECTOR` alone. It only runs while the
 * map tab is focused and foregrounded, i.e. only with the screen lit.
 */
export const HEADING_SENSOR_MS = 60;

/**
 * Below this much left to travel — with the rate estimate also spent — the
 * display has arrived: snap to the target and stop ticking. A quarter of a
 * degree is invisible on a map, and the position term is asymptotic, so
 * something has to declare the end.
 */
export const HEADING_SETTLED_DEG = 0.25;
/**
 * Longest gap one tick may account for. Four ticks' worth: enough that an
 * ordinary hiccup in the timer is absorbed, little enough that the first tick
 * after the ticker has been stopped cannot jump.
 */
const HEADING_MAX_STEP_MS = 2 * HEADING_TICK_MS;
/** ...and this slow. Both, or a phone still turning would be declared arrived
 *  every time the display happened to pass through the target. */
export const HEADING_SETTLED_RATE_DEG_PER_S = 2;

/**
 * Time constant of the RATE estimate, over target moves. THE SMOOTHNESS KNOB.
 *
 * Averages the sample-to-sample variation away so a steady turn produces a
 * steady rate. Too short and the rate inherits that variation and the motion
 * stutters; too long and the display takes that long to believe a turn has
 * started. At the measured 8 Hz this covers about two samples.
 */
export const HEADING_RATE_TAU_MS = 150;

/**
 * Longest gap between two target moves that may still be read as a turn rate.
 *
 * IT MUST CLEAR THE REAL SAMPLE CADENCE WITH ROOM TO SPARE, and briefly did
 * not: it was derived from HEADING_SENSOR_MS (120 ms) while the measured gap
 * between distinct readings is 133 ms median / 135 ms p90, so it rejected most
 * genuine moves and the rate estimator — the whole point of the design — was
 * silently inert, leaving a pure position chaser with 320 ms of lag. Pinned to
 * a measured number now, not to a dispatch interval that has nothing to do with
 * it: three times the observed cadence.
 *
 * A move that arrives after a long quiet spell is the FIRST move of a new turn,
 * not evidence of one already running: the phone was still for most of that
 * gap, so "degrees / gap" describes nothing. Feeding it in anyway made the very
 * first flick of a rested phone dead-reckon off a fabricated rate — a lurch, in
 * whatever direction that one sample pointed. The rate is left where it is
 * (zero, after the stall decay) and the next few moves build it honestly.
 */
const HEADING_RATE_MAX_GAP_MS = 400;

/**
 * ...and the shortest. A gap well under the sensor's own cadence cannot be a
 * measurement of how fast the phone is turning; it is delivery jitter, or two
 * readings arriving in one batch after a stall. Dividing a real angle by it
 * manufactures an enormous rate, and the display then dead-reckons off at that
 * speed until the next sample contradicts it — a lurch tens of degrees past
 * where the phone is pointing, which the lead cap widens rather than stops
 * (the cap scales WITH the rate). Half the measured 133 ms cadence.
 */
const HEADING_RATE_MIN_GAP_MS = 60;

/**
 * Time constant of the POSITION correction — how fast the display closes drift
 * between where dead reckoning put it and where the target actually is.
 *
 * DELIBERATELY SLOW, and it is the constant most likely to be "fixed" wrongly.
 * This term is the one that can see the input's staircase, so every millisecond
 * shaved off it puts some of the stutter back. It does not need to be fast: on
 * a real turn the rate estimate is already doing the tracking, and this is only
 * mopping up. It IS what handles a jump the rate cannot explain (a magnetic
 * anomaly, a recalibration), and handling those slowly is correct.
 *
 * A SECOND is not a typo. Simulated against the measured 8 Hz cadence, moving
 * from 300 ms to 1000 ms takes per-tick angular velocity ripple from 27 % of
 * the mean to 14 % at every turn rate, and costs nothing in lag, because the
 * rate term is what carries the tracking.
 */
export const HEADING_CATCHUP_TAU_MS = 1000;

/**
 * How far the display may run AHEAD of the target: a fixed part, plus this many
 * milliseconds' worth of the current rate.
 *
 * Dead reckoning has to be allowed to lead — that is the interpolation across
 * the gap between samples, and clamping it to zero would put the staircase
 * straight back. But an unbounded lead is an unbounded overshoot when the phone
 * stops between samples, and nothing can know it stopped until the next one.
 *
 * HEADING_LEAD_MS is therefore HALF the measured 133 ms gap between readings:
 * enough to interpolate across most of a gap, so the cap stops binding on every
 * sample of a fast turn (at 30 ms it bound constantly and the ripple at 60°/s
 * was 99 % of the mean), while bounding the worst-case overshoot at half a gap
 * of travel. Raising it trades overshoot for smoothness at high turn rates.
 * That is the whole of the trade, and it is the honest cost of an 8 Hz sensor.
 */
export const HEADING_LEAD_DEG = 3;
export const HEADING_LEAD_MS = 60;
/**
 * ...AND A HARD CEILING ON THE WHOLE THING, which is the part that was missing.
 *
 * The rate-scaled term above has no bound of its own, so the cap meant to LIMIT
 * overshoot grew with the very quantity it was limiting: a wrist flick at
 * ~1000°/s produced `3 + 1000 × 0.06` = 63° of permitted lead, and the map
 * duly ran 60° past where the phone was pointing and then crawled back. The
 * measured "under 5°" that this was signed off on came from a 110°/s turn and
 * did not generalise.
 *
 * 8° is the knee: overshoot off a hard flick drops from tens of degrees to ~7°
 * at every rate from 200 to 700°/s, with no measurable cost to the ripple at
 * 8/25/60°/s. Tightening to 6° buys 5° of overshoot and starts costing
 * smoothness at 60°/s (ripple 15 % → 21 %), because the cap then binds during
 * ordinary turns rather than only during flicks.
 */
export const HEADING_LEAD_MAX_DEG = 8;

/**
 * The rate estimate is only fed when the target MOVES, so after this long
 * without one — two of its own gaps, or 150 ms, whichever is longer — the
 * turn is treated as over and the estimate decays. Two rather than three
 * because this delay is how long the display keeps dead-reckoning after the
 * phone has actually stopped, and that is overshoot the user sees. Relative to the observed
 * cadence rather than absolute, because that cadence runs from ~50 ms during a
 * fast turn to seconds during a slow one.
 */
const HEADING_RATE_STALL_MULTIPLE = 2;
const HEADING_RATE_STALL_FLOOR_MS = 150;

/**
 * Slack the target carries around the raw sample, in degrees — a DRAG
 * follower, not a gate. The target only moves far enough to stay within this
 * much of the sample, so a still phone's residual wander moves it NOT AT ALL —
 * the tracker settles, the ticker stops, and nothing rotates. That is the fix
 * for "a completely still phone rotates the map", and it also absorbs hand
 * tremor. A real turn drags the target continuously, offset by this much, so
 * there is no staircase — which is what killed the old ≥3° gate.
 *
 * IT WAS 2.5° AGAINST THE OLD SENSOR, sized to the 2.03° quantum
 * `expo-location` reported in. It is 1° now, and what sizes it is HAND TREMOR,
 * not sensor noise: a Pixel 9 lying still measures 0.053° peak-to-peak of
 * wander (`HDGPROBE`, 35 s, 2026-08-17), twenty times inside this band, so the
 * gyro-fused source contributes essentially nothing towards moving the target.
 * A phone being HELD wanders far more than that, and that is real rotation
 * rather than noise — absorbing it is this constant's actual job.
 *
 * THAT MARGIN IS THE BATTERY ARGUMENT, and it is narrower than it looks. The
 * "a still phone stops the ticker" property holds only while the wander stays
 * inside this band: past it the drag follower ratchets 1:1 with the noise, the
 * display can never catch a target oscillating at sample rate, and the ticker
 * runs for as long as the map is open. Measured duty cycle goes from 0.2 % at
 * ±1.0° to 82 % at ±2.0°, a cliff sitting exactly at this constant.
 * `heading.test.ts` ("stops ticking below the hysteresis, and only below it")
 * pins both sides of it — do not lower this without moving that test's floor
 * and re-measuring on hardware.
 *
 * The cost is a standing bias of up to this much in whichever direction the
 * user last turned.
 */
export const HEADING_HYSTERESIS_DEG = 1;

/** Signed shortest turn from `from` to `to`, in [-180, 180). */
export function shortestAngleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * Ceiling on how fast the DISPLAYED bearing may turn, in degrees per second.
 *
 * This is the constant that makes the compass feel calm. A person turning on
 * the spot manages maybe 180°/s; a magnetometer sitting still on a rock can
 * appear to do thousands, and every one of those spikes used to reach the
 * screen (and, in course-up, the whole map). Capping the rate means a spike
 * spends itself as a fraction of a degree before the filter has pulled the
 * average back, while a real turn of the body still completes in about a
 * second.
 *
 * It is set ABOVE a person's fastest turn on purpose. At 180°/s — roughly a
 * brisk turn — a 90° flick of the wrist needed three camera writes to catch up
 * in course-up, and three writes read as three bursts rather than one movement.
 * The exponential filter above is what handles noise; this only has to catch
 * the deltas no wrist produces (a recalibration, a magnetic anomaly, a wrap
 * glitch near north), so it can sit well clear of real motion.
 */
export const HEADING_MAX_SLEW_DEG_PER_S = 360;

// ── course-up's camera ───────────────────────────────────────────────────────
//
/**
 * THE ANIMATION MUST BE LINEAR, AND THAT IS THE WHOLE TRICK. MLRN sends no
 * animation mode unless you ask for one, and the Android side defaults to
 * `CameraMode.EASE` → `easeCamera(update, duration, true)`, whose `true` is an
 * accelerate-decelerate interpolator (`CameraUpdateItem.java`). Every stop
 * therefore STARTS FROM REST. Issue one per sensor sample and the camera spends
 * its whole life in the slow opening of an ease it never finishes: the map
 * lurches, pauses, lurches. A small turn producing two stops reads as exactly
 * two jumps, which is what it was doing.
 *
 * `linearTo` maps to `easeCamera(update, duration, false)` — constant angular
 * velocity — so consecutive stops hand over without either of them braking, and
 * a turn reads as one movement however many stops it took.
 *
 * With the curve fixed, the remaining requirement is that each stop take
 * exactly as long as the segment it is covering. That is now trivial, because
 * the writes come from the fixed HEADING_TICK_MS ticker rather than from sensor
 * samples: every segment is the same length, so the angular velocity is the
 * same from one to the next. Driving them off the irregular sample stream is
 * what made the rotation seem to slow down and pick up again mid-turn.
 *
 * The deadband is what keeps a phone held still from writing at all, so the
 * renderer still goes idle — and the ticker stops entirely on top of that.
 */
/**
 * The tick gets a little headroom before becoming the duration.
 *
 * `easeCamera` CANCELS the animation in flight rather than blending into it
 * (`Transform.easeCamera` calls `cancelTransitions()` first), so a stop that
 * ends exactly when the next arrives will sometimes end a few milliseconds
 * early and stall. A little more than the tick means the cancel always lands
 * inside the segment — and because the segment is linear, being cancelled
 * part-way through costs nothing: the velocity there is the same as anywhere
 * else in it. Kept just above 1 now that the interval is regular; the old 1.25
 * left the camera a visible fraction of a step behind the filter.
 */
export const POV_ANIMATION_HEADROOM = 1.15;
/** Clamp, so a stalled timer cannot produce a long glide and a burst of catch-up
 *  ticks cannot produce a stutter. */
export const POV_ANIMATION_MIN_MS = 32;
export const POV_ANIMATION_MAX_MS = 400;
/**
 * Small on purpose, and only there to let a still phone stop writing at all —
 * NOT to shape the motion. A deadband wide enough to be felt leaves the map
 * settled short of the true heading, which reads as the rotation giving up
 * early. MapLibre's own follower has no deadband whatsoever and rate-limits
 * instead; this keeps a token one so course-up on a phone lying on a rock costs
 * nothing.
 */
export const POV_DEADBAND_DEG = 0.15;

/**
 * How far down the screen course-up puts the user, as a fraction of the map's
 * height. 0.75 = three quarters down, which is what Gaia does and what a person
 * walking actually wants: the ground you are about to cross is worth three
 * times the screen of the ground behind you.
 *
 * Implemented by moving the CAMERA CENTRE forward along the heading rather than
 * by MapLibre's camera padding: padding on Android is only applied by a stop
 * that also carries a target, so it survives stops that do not and the map
 * stays offset after course-up is left.
 */
export const POV_USER_SCREEN_FRACTION = 0.75;

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

/**
 * Where the camera has to look so the user's own position lands
 * POV_USER_SCREEN_FRACTION of the way down a `mapHeightPx`-tall map: forward
 * along `headingDeg`, because in course-up forward is up the screen.
 *
 * Flat-earth offset — the distance is a few hundred metres at any usable zoom,
 * where the great-circle correction is well under a metre.
 */
export function povCameraCenter(
  fix: [number, number],
  headingDeg: number,
  zoom: number,
  mapHeightPx: number,
): [number, number] {
  const [longitude, latitude] = fix;
  const forwardPx = (POV_USER_SCREEN_FRACTION - 0.5) * mapHeightPx;
  if (!Number.isFinite(forwardPx) || forwardPx === 0) return fix;
  const meters = forwardPx * metersPerPixel(latitude, zoom);
  const bearing = normalizeBearing(headingDeg) * DEG;
  const dLat = ((meters * Math.cos(bearing)) / EARTH_RADIUS_M) / DEG;
  const dLon =
    ((meters * Math.sin(bearing)) /
      (EARTH_RADIUS_M * Math.cos(latitude * DEG))) /
    DEG;
  return [longitude + dLon, latitude + dLat];
}

/**
 * Tracker state. Mutated in place — one per screen. Samples go in through
 * `noteHeadingSample` (irregular, whenever the platform feels like it) and the
 * display comes out of `stepHeadingFilter` (regular, HEADING_TICK_MS).
 */
export type HeadingFilter = {
  /** The displayed bearing, or null before the first sample. */
  value: number | null;
  /** What the display is tracking: the sample, dragged by the hysteresis. */
  target: number | null;
  /** Smoothed rate the TARGET is moving at, degrees per second. The display
   *  dead-reckons on this; it is the reason the motion is smooth. */
  rateDegPerS: number;
  /** The gap between the last two target moves, so "the turn has stopped" is
   *  judged against the cadence actually being seen. */
  lastTargetGapMs: number;
  /** Timestamps. Null until the first one happens — a real epoch millisecond is
   *  never 0, but a test's clock is, and a zero sentinel silently disables the
   *  rate term. */
  lastTargetMoveAt: number | null;
  lastStepAt: number | null;
  /** `Date.now()` minus the sensor clock, fixed at the first sample. See
   *  `deviceSampleTimeMs`. */
  sensorClockOffsetMs: number | null;
};

export function createHeadingFilter(): HeadingFilter {
  return {
    value: null,
    target: null,
    rateDegPerS: 0,
    lastTargetGapMs: 0,
    lastTargetMoveAt: null,
    lastStepAt: null,
    sensorClockOffsetMs: null,
  };
}

/** Fraction of the remaining distance a first-order low-pass closes in `dtMs`. */
function lowPassAlpha(tauMs: number, dtMs: number): number {
  return dtMs / (tauMs + dtMs);
}

/**
 * When a `DeviceMotion` reading was actually TAKEN, in the `Date.now()` domain.
 *
 * `rotation.timestamp` is the Android `SensorEvent` timestamp — nanoseconds on
 * a monotonic clock, converted to seconds by `DeviceMotionModule.kt:253`. Using
 * it rather than arrival time is what makes the rate estimate trustworthy: the
 * dispatch interval is a throttle we chose (HEADING_SENSOR_MS) and has nothing
 * to do with when the sensor sampled, so measuring gaps on arrival quantises a
 * 133 ms interval to the dispatch grid and puts ±25 % of noise straight into
 * the one number the whole tracker integrates.
 *
 * The two clocks differ by a constant (one counts from boot), so one offset
 * captured at the first sample converts between them. Session-scoped, and it
 * dies with the filter; the drift between Android's monotonic and wall clocks
 * over a map session is far below a millisecond.
 *
 * Falls back to `nowMs` when a reading carries no timestamp, so a device or a
 * platform that omits it degrades to arrival timing rather than breaking.
 */
export function deviceSampleTimeMs(
  filter: HeadingFilter,
  timestampSeconds: number | undefined,
  nowMs: number,
): number {
  if (timestampSeconds == null || !Number.isFinite(timestampSeconds)) return nowMs;
  const sensorMs = timestampSeconds * 1000;
  filter.sensorClockOffsetMs ??= nowMs - sensorMs;
  return sensorMs + filter.sensorClockOffsetMs;
}

/**
 * Take one sensor sample. Moves the TARGET and the rate estimate only — nothing
 * is displayed from here, because the display runs on its own clock (see
 * HEADING_TICK_MS).
 *
 * Returns true when the target actually moved, which is the caller's cue to
 * make sure the ticker is running.
 */
export function noteHeadingSample(
  filter: HeadingFilter,
  sample: number,
  nowMs: number,
): boolean {
  const wrapped = normalizeBearing(sample);
  if (filter.target == null) {
    filter.target = wrapped;
    filter.lastTargetMoveAt = nowMs;
    return true;
  }
  const drift = shortestAngleDelta(filter.target, wrapped);
  if (Math.abs(drift) <= HEADING_HYSTERESIS_DEG) return false;
  // Drag, don't jump: keep the target exactly HEADING_HYSTERESIS_DEG behind the
  // sample so continuous motion produces continuous target movement.
  const moved = drift - Math.sign(drift) * HEADING_HYSTERESIS_DEG;
  const gapMs = filter.lastTargetMoveAt == null ? 0 : nowMs - filter.lastTargetMoveAt;
  if (gapMs > 0) {
    filter.lastTargetGapMs = Math.min(gapMs, HEADING_RATE_MAX_GAP_MS);
    // Averaged over the REAL gap, not per sample: the same turn reported twice
    // as often must not read as twice the rate. A gap too long to be a sampling
    // interval is the start of a turn rather than a measurement of one, and a
    // gap too short is not a measurement at all.
    if (gapMs >= HEADING_RATE_MIN_GAP_MS && gapMs <= HEADING_RATE_MAX_GAP_MS) {
      // Clamped to the ceiling the DISPLAY obeys: a rate faster than the
      // display may ever turn is not something to dead-reckon on, it is just a
      // bigger lead cap and a longer overshoot.
      const instant = Math.max(
        -HEADING_MAX_SLEW_DEG_PER_S,
        Math.min(HEADING_MAX_SLEW_DEG_PER_S, (moved * 1000) / gapMs),
      );
      filter.rateDegPerS +=
        lowPassAlpha(HEADING_RATE_TAU_MS, gapMs) * (instant - filter.rateDegPerS);
    }
  }
  filter.target = normalizeBearing(filter.target + moved);
  filter.lastTargetMoveAt = nowMs;
  return true;
}

/**
 * Advance the displayed bearing one tick, the long way round never taken:
 * averaging 359° and 1° in plain degrees gives 180°, which points the arrow
 * backwards exactly when the user is walking north.
 *
 * Returns the new displayed bearing, or null before the first sample. Ask
 * `headingSettled` whether the caller may stop ticking.
 *
 * A large jump is NOT followed immediately. The sensor produces big deltas for
 * its own reasons (a recalibration, a magnetic anomaly at a car park or a
 * steel-toed boot, a wrap glitch near north); the rate estimate refuses to
 * believe one sample, HEADING_CATCHUP_TAU_MS bleeds it in over most of a
 * second, and the slew ceiling is the last resort.
 */
export function stepHeadingFilter(
  filter: HeadingFilter,
  nowMs: number,
): number | null {
  if (filter.target == null) return null;
  if (filter.value == null) {
    filter.value = filter.target;
    filter.lastStepAt = nowMs;
    return filter.value;
  }
  // A hostile or absent gap must not make the filter a no-op or a passthrough,
  // and A LATE TICK MUST NOT TELEPORT THE DISPLAY. The ticker STOPS while the
  // phone is still, so the first tick after a rest sees a gap of however long
  // that rest was — seconds — and one step of catch-up scaled to it, which
  // arrived as a lurch in whatever direction the very first sample happened to
  // point. The same thing on a smaller scale whenever the timer is starved.
  // This is an animation clock: missing frames means drawing the frames you
  // did get, not covering the whole gap in one of them.
  const dt = Math.min(
    Math.max(filter.lastStepAt == null ? HEADING_TICK_MS : nowMs - filter.lastStepAt, 1),
    HEADING_MAX_STEP_MS,
  );
  filter.lastStepAt = nowMs;

  // Has the turn stopped? Judged against the cadence being seen, because that
  // runs from ~50 ms in a fast turn to seconds in a slow one.
  const sinceMove =
    filter.lastTargetMoveAt == null ? Infinity : nowMs - filter.lastTargetMoveAt;
  const stallMs = Math.max(
    HEADING_RATE_STALL_FLOOR_MS,
    HEADING_RATE_STALL_MULTIPLE * (filter.lastTargetGapMs || 200),
  );
  if (sinceMove > stallMs) {
    filter.rateDegPerS -= lowPassAlpha(HEADING_RATE_TAU_MS, dt) * filter.rateDegPerS;
  }

  // Dead reckon, then correct the drift slowly. The first term is what makes a
  // turn look like one movement; the second is only mopping up.
  const drift = shortestAngleDelta(filter.value, filter.target);
  let next =
    filter.value +
    (filter.rateDegPerS * dt) / 1000 +
    drift * lowPassAlpha(HEADING_CATCHUP_TAU_MS, dt);

  // Never lead the target by more than about one sample gap of travel: that is
  // exactly the interpolation we want, and everything past it is overshoot
  // waiting to happen when the phone stops between samples.
  //
  // ONLY IN THE DIRECTION OF TRAVEL. Being on the far side of the target is a
  // lead; being short of it is not, and clamping that too turns the cap into a
  // snap — a display 25° behind was yanked to within a degree of the target in
  // a single tick, which is precisely the "jumped, then came back" the slow
  // catch-up term exists to prevent.
  const leadCap = Math.min(
    HEADING_LEAD_DEG + (Math.abs(filter.rateDegPerS) * HEADING_LEAD_MS) / 1000,
    HEADING_LEAD_MAX_DEG,
  );
  const heading =
    Math.sign(filter.rateDegPerS) ||
    Math.sign(shortestAngleDelta(filter.value, next));
  const lead = shortestAngleDelta(filter.target, next);
  if (heading !== 0 && Math.sign(lead) === heading && Math.abs(lead) > leadCap) {
    next = filter.target + heading * leadCap;
  }

  let step = shortestAngleDelta(filter.value, normalizeBearing(next));
  const maxStep = (HEADING_MAX_SLEW_DEG_PER_S * dt) / 1000;
  if (Math.abs(step) > maxStep) step = Math.sign(step) * maxStep;
  // Arrival, so the ticker can stop instead of riding an asymptote.
  if (
    Math.abs(drift) <= HEADING_SETTLED_DEG &&
    Math.abs(filter.rateDegPerS) <= HEADING_SETTLED_RATE_DEG_PER_S
  ) {
    step = drift;
    filter.rateDegPerS = 0;
  }
  filter.value = normalizeBearing(filter.value + step);
  return filter.value;
}

/**
 * True once the display has caught the target AND has no rate left to spend, so
 * the ticker may stop. Both halves matter: a phone mid-turn passes through its
 * own target constantly, and stopping there would strand the rotation.
 */
export function headingSettled(filter: HeadingFilter): boolean {
  if (filter.value == null || filter.target == null) return false;
  return (
    Math.abs(shortestAngleDelta(filter.value, filter.target)) <=
      HEADING_SETTLED_DEG &&
    Math.abs(filter.rateDegPerS) <= HEADING_SETTLED_RATE_DEG_PER_S
  );
}

/**
 * Magnetic declination for the NSW canyoning area, degrees EAST of true north
 * (Blue Mountains / Wollemi ≈ +12.4°, Kanangra ≈ +12.2°, the far south coast
 * ≈ +12.9°).
 *
 * THE FALLBACK, not the only source. `learnDeclination` derives the real value
 * from Android's own `GeomagneticField` as soon as there is a fix (see there
 * for the trick), so this is what a guest with location denied gets, and what
 * everyone gets for the seconds before the first fix. Worth ≤1° inside NSW and
 * wrong outside it — which now only matters until a fix arrives.
 */
export const NSW_MAGNETIC_DECLINATION_DEG = 12.5;

/**
 * Does this sample carry a real true heading, or the no-fix sentinel?
 *
 * NOT `>= 0`, which is the obvious test and is wrong west of the agonic line.
 * `calcTrueNorth` is `(magNorth + declination) % 360` in Kotlin
 * (`LocationModule.kt:603-607`), and Kotlin's `%` keeps the sign — so anywhere
 * declination is WESTERN the real answer comes back negative and a `>= 0` test
 * silently reads it as "no fix" and pins the app to the NSW constant. Only the
 * exact -1 is the sentinel. (A genuine -1.0 is indistinguishable and costs one
 * ignored sample, which the next one replaces.)
 */
function hasTrueHeading(trueHeading: number): boolean {
  return Number.isFinite(trueHeading) && trueHeading !== -1;
}

/**
 * The declination actually in force, degrees east of true north.
 *
 * Defaults to the NSW constant and is replaced by the real thing as soon as a
 * fix makes one available — see `learnDeclination`. Module state rather than
 * filter state because it describes WHERE THE USER IS, which outlives any one
 * screen's sensor subscription; the fallback is what a guest with location
 * denied keeps using.
 */
let declinationDeg = NSW_MAGNETIC_DECLINATION_DEG;

/** Where `declinationDeg` was computed, so it can be recomputed on travel. */
let declinationAt: { latitude: number; longitude: number } | null = null;

/**
 * Adopt a real declination, derived rather than computed.
 *
 * `expo-location`'s heading sample carries both norths, and
 * `LocationModule.kt:603-607` builds the true one as
 * `magHeading + GeomagneticField.declination`. So their difference IS Android's
 * own WMM declination for the device's current fix, and subtracting it gets us
 * the exact value with no native module, no offline model and no new
 * dependency. `trueHeading` is -1 whenever there is no fix to compute it from,
 * which is the case this returns false for.
 */
export function learnDeclination(sample: {
  trueHeading: number;
  magHeading: number;
}): boolean {
  if (!hasTrueHeading(sample.trueHeading) || !(sample.magHeading >= 0)) return false;
  declinationDeg = shortestAngleDelta(sample.magHeading, sample.trueHeading);
  return true;
}

/** Remember where that was learned, so travel can invalidate it. */
export function noteDeclinationFix(latitude: number, longitude: number): void {
  declinationAt = { latitude, longitude };
}

/**
 * Far enough from the last one to be worth re-deriving, in degrees of latitude
 * or longitude. Declination moves with POSITION, not with time — its secular
 * drift is about 0.1°/year — so distance is the only trigger that matters and
 * no TTL is needed. Half a degree is ~55 km, which is worth well under a degree
 * of declination anywhere in the operating area.
 */
const DECLINATION_REFRESH_DEG = 0.5;

/** Whether a fix has moved far enough that the declination should be re-derived. */
export function declinationNeedsRefresh(
  latitude: number,
  longitude: number,
): boolean {
  if (declinationAt == null) return true;
  return (
    Math.abs(latitude - declinationAt.latitude) > DECLINATION_REFRESH_DEG ||
    Math.abs(longitude - declinationAt.longitude) > DECLINATION_REFRESH_DEG
  );
}

/**
 * The declination in force, degrees east of true north.
 *
 * Exported because the compass tape's magnetic mode has to subtract exactly
 * what the forward path added — it was subtracting the NSW constant while
 * `resolveTrueHeading` added the learned value, which is two sources for one
 * number and the tape's labels drifting from the map by `learned − 12.5`.
 */
export function currentDeclinationDeg(): number {
  return declinationDeg;
}

/** Test seam, and the sign-out reset: forget what was learned. */
export function resetDeclination(): void {
  declinationDeg = NSW_MAGNETIC_DECLINATION_DEG;
  declinationAt = null;
}

/**
 * Compass bearing from `DeviceMotion`'s `rotation.alpha`, in degrees, or null
 * when the device produced no orientation at all.
 *
 * `alpha` is radians, and is `-orientation[0]` — `DeviceMotionModule.kt` negates
 * Android's azimuth on the way out to match the web DeviceOrientation
 * convention. Negating it back gives the angle from MAGNETIC north, clockwise,
 * which is the same quantity `expo-location` used to report as `magHeading`, so
 * it goes through the same declination correction and everything downstream is
 * unchanged.
 *
 * Portrait-locked app (`app.json`), so no screen-rotation remap is needed: the
 * top of the phone is the direction being reported, which is the direction the
 * user is facing when they hold it up to look at the map.
 */
export function headingFromDeviceRotation(
  rotation: { alpha: number } | null | undefined,
): number | null {
  if (!rotation || !Number.isFinite(rotation.alpha)) return null;
  const magneticDeg = (-rotation.alpha * 180) / Math.PI;
  // Reuse the one declination path, rather than a second copy of it here.
  return resolveTrueHeading({ trueHeading: -1, magHeading: normalizeBearing(magneticDeg) });
}

/**
 * True-north heading from an expo-location heading sample, or null when the
 * device has nothing usable.
 *
 * The correction is `declinationDeg` — the real one once `learnDeclination`
 * has had a fix to derive it from, and the NSW constant until then.
 *
 * `trueHeading` is -1 whenever expo-location has no location fix to compute
 * declination from — which is the norm on a cold start in the bush, exactly
 * where this matters. The old code silently fell back to `magHeading` and drew
 * it as if it were true, so the arrow pointed 12.5° off while the
 * navigate-to-waypoint chip beside it printed a real great-circle bearing:
 * two different norths on one screen. Walk a kilometre on that arrow and you
 * arrive ~220 m from where you aimed.
 */
export function resolveTrueHeading(sample: {
  trueHeading: number;
  magHeading: number;
}): number | null {
  if (hasTrueHeading(sample.trueHeading)) {
    return normalizeBearing(sample.trueHeading);
  }
  if (!(sample.magHeading >= 0)) return null;
  return normalizeBearing(sample.magHeading + declinationDeg);
}

/**
 * A bearing folded into 0..360, so "is the map facing north" is a single
 * comparison. A non-finite input reads as north rather than propagating NaN
 * into a camera stop, which MapLibre answers by not moving at all.
 */
export function normalizeBearing(heading: number): number {
  if (!Number.isFinite(heading)) return 0;
  return ((heading % 360) + 360) % 360;
}

// ── the live heading, deliberately outside React state ───────────────────────
//
// THIS IS A BATTERY BOUNDARY, not a style preference. The compass is on by
// default and the platform delivers up to about five samples a second, and
// while the heading lived in
// MapScreen's `useState` every one of those samples re-rendered the whole map
// screen: MapView, the ~71 Protomaps basemap layers (MLRN memoises none of
// them, and re-runs `transformStyle` + a native prop commit per layer per
// render), every topo overlay, every route layer, and every bottom sheet's
// element tree including the ones that are shut. Twenty times a second, for as
// long as the app was open.
//
// Exactly two things draw the heading — the location arrow and the compass
// tape. They subscribe here instead, so a sample re-renders those two and
// nothing else. Anything else that wants the heading should subscribe too, not
// lift it back into a screen's state.
let liveHeading: number | null = null;
const headingListeners = new Set<() => void>();

/** Publish a smoothed sample (or null when the sensor stops). */
export function publishHeading(next: number | null): void {
  if (next === liveHeading) return;
  liveHeading = next;
  for (const listener of headingListeners) listener();
}

function getLiveHeading(): number | null {
  return liveHeading;
}

function subscribeHeading(listener: () => void): () => void {
  headingListeners.add(listener);
  return () => {
    headingListeners.delete(listener);
  };
}

/** The live smoothed heading, re-rendering only the component that reads it. */
export function useLiveHeading(): number | null {
  return useSyncExternalStore(subscribeHeading, getLiveHeading);
}

/**
 * Whether there is a heading at all, without subscribing to its VALUE.
 *
 * For the parts that only branch on "is the compass working" — course-up draws
 * the arrow straight up the screen, so the bearing is not on screen at all and
 * re-rendering it thirty times a second redraws a constant. `useSyncExternalStore`
 * bails out when the snapshot is unchanged, so this re-renders twice a session.
 */
export function useHasLiveHeading(): boolean {
  return useSyncExternalStore(subscribeHeading, hasLiveHeading);
}

function hasLiveHeading(): boolean {
  return liveHeading != null;
}

/**
 * The live heading rounded to `HEADING_DISPLAY_STEP_DEG`.
 *
 * For the compass tape, which rebuilds ~30 native views per render and moves
 * them by 2.2 px per degree. A quarter of a degree is half a pixel there — below
 * anything a reader can see — so quantising collapses most of the re-renders at
 * slow turn rates for free, again through `useSyncExternalStore`'s bail-out.
 * The MAP is not quantised: it animates natively between camera stops and wants
 * every bit of resolution it can get.
 */
export const HEADING_DISPLAY_STEP_DEG = 0.25;

export function useQuantisedLiveHeading(): number | null {
  return useSyncExternalStore(subscribeHeading, getQuantisedLiveHeading);
}

function getQuantisedLiveHeading(): number | null {
  if (liveHeading == null) return null;
  return Math.round(liveHeading / HEADING_DISPLAY_STEP_DEG) * HEADING_DISPLAY_STEP_DEG;
}
