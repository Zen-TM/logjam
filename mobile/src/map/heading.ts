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
 * How often the sensor itself is asked to report, in ms.
 *
 * Faster than the ticker on purpose, so every tick has something newer than the
 * last one to work with. ~33 Hz — six times what `expo-location` allowed, and
 * the reason the constants below could be tightened so far: the display now
 * interpolates across a 30 ms gap instead of a 200 ms one.
 *
 * ponytail: `DeviceMotion` registers five sensors (gyro, accel, linear accel,
 * rotation vector, gravity) at `SENSOR_DELAY_FASTEST` and we read one of them.
 * That is the price of not writing a native module; the upgrade path, if the
 * field battery numbers ever object, is our own Expo module exposing
 * `TYPE_ROTATION_VECTOR` alone at exactly this rate. It only runs while the map
 * tab is focused and foregrounded, i.e. only with the screen lit.
 */
export const HEADING_SENSOR_MS = 30;

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
 * Long, because a steady turn's samples all imply the same rate and the whole
 * point is to average the staircase away. Too short and the rate inherits the
 * quantisation and the motion stutters again; too long and the display takes
 * that long to believe a turn has started.
 */
export const HEADING_RATE_TAU_MS = 250;

/**
 * Longest gap between two target moves that may still be read as a turn rate.
 *
 * A move that arrives after a long quiet spell is the FIRST move of a new turn,
 * not evidence of one already running: the phone was still for most of that
 * gap, so "degrees / gap" describes nothing. Feeding it in anyway made the very
 * first flick of a rested phone dead-reckon off a fabricated rate — a lurch, in
 * whatever direction that one sample pointed. The rate is left where it is
 * (zero, after the stall decay) and the next few moves build it honestly.
 */
const HEADING_RATE_MAX_GAP_MS = 4 * HEADING_SENSOR_MS;

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
 */
export const HEADING_CATCHUP_TAU_MS = 300;

/**
 * How far the display may run AHEAD of the target: a fixed part, plus this many
 * milliseconds' worth of the current rate.
 *
 * Dead reckoning has to be allowed to lead — that is the interpolation across
 * the gap between samples, and clamping it to zero would put the staircase
 * straight back. But an unbounded lead is an unbounded overshoot when the phone
 * stops between samples, so it is capped at roughly one sample gap of travel.
 * The rate-scaled part is what keeps a fast turn smooth (its target steps are
 * ~6°, so a 3° cap would bind on every one of them) without letting a slow one
 * drift.
 */
export const HEADING_LEAD_DEG = 1;
export const HEADING_LEAD_MS = 30;

/**
 * The rate estimate is only fed when the target MOVES, so after this long
 * without one — three of its own gaps, or 150 ms, whichever is longer — the
 * turn is treated as over and the estimate decays. Relative to the observed
 * cadence rather than absolute, because that cadence runs from ~50 ms during a
 * fast turn to seconds during a slow one.
 */
const HEADING_RATE_STALL_MULTIPLE = 3;
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
 * `expo-location` reported in. The rotation vector is continuous and far
 * quieter, so it is 1° now — less standing bias, and less of a dead zone at the
 * very start of a turn. THIS IS THE FIRST KNOB TO RAISE if a phone lying still
 * ever creeps again.
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
};

export function createHeadingFilter(): HeadingFilter {
  return {
    value: null,
    target: null,
    rateDegPerS: 0,
    lastTargetGapMs: 0,
    lastTargetMoveAt: null,
    lastStepAt: null,
  };
}

/** Fraction of the remaining distance a first-order low-pass closes in `dtMs`. */
function lowPassAlpha(tauMs: number, dtMs: number): number {
  return dtMs / (tauMs + dtMs);
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
    // interval is the start of a turn, not a measurement of one.
    if (gapMs <= HEADING_RATE_MAX_GAP_MS) {
      filter.rateDegPerS +=
        lowPassAlpha(HEADING_RATE_TAU_MS, gapMs) *
        ((moved * 1000) / gapMs - filter.rateDegPerS);
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
  const leadCap =
    HEADING_LEAD_DEG + (Math.abs(filter.rateDegPerS) * HEADING_LEAD_MS) / 1000;
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
 * ponytail: one constant for the whole operating area, worth ≤1° of error
 * inside NSW and wrong outside it. The upgrade path is Android's
 * `GeomagneticField` (or a WMM port) through a tiny native call, keyed on the
 * user's own fix — worth doing the day the app is used outside this state.
 */
export const NSW_MAGNETIC_DECLINATION_DEG = 12.5;

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
  if (sample.trueHeading >= 0) return sample.trueHeading;
  if (!(sample.magHeading >= 0)) return null;
  return (
    (((sample.magHeading + NSW_MAGNETIC_DECLINATION_DEG) % 360) + 360) % 360
  );
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
