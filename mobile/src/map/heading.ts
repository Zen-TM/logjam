// Compass-heading smoothing.
//
// WHAT THE PLATFORM ACTUALLY GIVES US, because every constant below is shaped
// by it: expo-location registers the accelerometer and the magnetometer at
// `SENSOR_DELAY_NORMAL` (~5 Hz, not settable from JS) and emits only when the
// azimuth has moved more than **2 degrees** and 50 ms have passed
// (`LocationModule.kt`, DEGREE_DELTA/TIME_DELTA). It applies no filter of its
// own to the raw sensor vectors.
//
// So the stream we receive is already a staircase: irregular, ~5 samples a
// second at best, in steps of at least 2°, and a phone lying still on a rock
// still emits whenever its noise crosses that threshold. Nothing we do can ask
// for a smoother source — the smoothing has to happen here, and it has to
// interpolate ACROSS those steps rather than merely average them.
//
// Two filters, in this order:
//   1. a time-aware exponential average (HEADING_TAU_MS), so the result does
//      not depend on how often the platform felt like reporting; and
//   2. a ceiling on how fast the displayed bearing may turn
//      (HEADING_MAX_SLEW_DEG_PER_S), which is what turns a noise spike into a
//      small drift instead of a snap.
//
// Gating was tried first and is worse: ignoring changes under 3° removed the
// small wobble and kept the big one, so the arrow sat still and then jumped.
//
// The live value lives at the bottom of this file, OUTSIDE React state, for
// battery: see `publishHeading`.
import { useSyncExternalStore } from "react";

/**
 * Floor on how often the smoothed heading may reach the arrow and the tape.
 *
 * A ceiling in name only: the platform's own 50 ms gate means samples cannot
 * arrive faster than this anyway, and in practice arrive at about a fifth of
 * it. It is kept as a guard against a device that reports faster, not as the
 * thing that makes the compass cheap.
 */
export const HEADING_RENDER_MS = 50;

/** Signed shortest turn from `from` to `to`, in [-180, 180). */
export function shortestAngleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * Time constant of the exponential filter: a step change is ~63 % closed after
 * this long, ~95 % after three of them.
 *
 * Expressed as a time rather than a per-sample weight because the sample rate
 * is not ours to choose and is not even steady — the same weight applied to an
 * irregular stream makes the compass feel different depending on how fast the
 * user happens to be turning, which is exactly the "over-sensitive" complaint.
 *
 * IT IS DELIBERATELY SHORT, because it is no longer the thing doing the
 * smoothing. Once the camera interpolates linearly over each interval
 * (POV_CAMERA_MS), the native ramp is the smoother and this only has to kill
 * sensor noise. Left long, the two compound: an exponential tail reaches the
 * camera as a geometrically decaying series of ever-smaller deltas, the last of
 * which fall under the deadband and are dropped — a rotation that lurches twice
 * and then stops several degrees short of where the phone is actually pointing.
 * MapLibre's own compass follower damps about this hard
 * (`LocationComponentCompassEngine`, ALPHA 0.45 at 10 Hz) for the same reason.
 */
export const HEADING_TAU_MS = 250;

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

/** Assumed gap when a caller does not know how long it has been. Roughly the
 *  platform's own delivery period. */
const DEFAULT_SAMPLE_GAP_MS = 200;

/**
 * Course-up's camera.
 *
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
 * exactly as long as the gap it is covering: animate over the MEASURED interval
 * since the last write and the on-screen rotation runs at the same speed as the
 * phone. A fixed duration cannot do that, because sample delivery is irregular
 * (see the platform note at the top of this file).
 *
 * The throttle is now only a ceiling on write frequency — the platform's own
 * 50 ms gate does most of the limiting — and the deadband is what keeps a phone
 * held still from writing at all, so the renderer still goes idle.
 */
export const POV_CAMERA_MS = 80;
/**
 * The measured interval gets a little headroom before becoming the duration.
 *
 * `easeCamera` CANCELS the animation in flight rather than blending into it
 * (`Transform.easeCamera` calls `cancelTransitions()` first), so a stop that
 * ends exactly when the next arrives will sometimes end a few milliseconds
 * early and stall. A quarter more than the interval means the cancel always
 * lands inside the segment — and because the segment is linear, being cancelled
 * part-way through costs nothing: the velocity there is the same as anywhere
 * else in it.
 */
export const POV_ANIMATION_HEADROOM = 1.25;
/** Clamp, so one late sample cannot produce a long glide and a burst of them
 *  cannot produce a stutter. */
export const POV_ANIMATION_MIN_MS = 80;
export const POV_ANIMATION_MAX_MS = 400;
/**
 * Small on purpose, and only there to let a still phone stop writing at all —
 * NOT to shape the motion. A deadband wide enough to be felt truncates the
 * filter's tail (see HEADING_TAU_MS) and leaves the map settled short of the
 * true heading, which reads as the rotation giving up early. MapLibre's own
 * follower has no deadband whatsoever and rate-limits instead; this keeps a
 * token one so course-up on a phone lying on a rock costs nothing.
 */
export const POV_DEADBAND_DEG = 0.5;

/**
 * Fold one sample into the running average, the long way round never taken:
 * averaging 359° and 1° in plain degrees gives 180°, which points the arrow
 * backwards exactly when the user is walking north.
 *
 * `elapsedMs` is the gap since the previous sample. Both filters are defined
 * per second, so a long gap (the first sample after a suspend, a phone that
 * emitted nothing while it sat still) closes proportionally more of the
 * distance and the arrow catches up rather than crawling.
 *
 * A large jump is NOT followed immediately any more. It used to be, on the
 * theory that a big delta is a real turn — but the sensor produces big deltas
 * for its own reasons (a recalibration, a magnetic anomaly at a car park or a
 * steel-toed boot, a wrap glitch near north), and that exemption was the single
 * most visible source of the snap. A real half-turn now takes about a second
 * and a half, which is what turning your body takes.
 */
export function smoothHeading(
  previous: number | null,
  sample: number,
  elapsedMs: number = DEFAULT_SAMPLE_GAP_MS,
): number {
  const wrapped = ((sample % 360) + 360) % 360;
  if (previous == null) return wrapped;
  const delta = shortestAngleDelta(previous, wrapped);
  // A hostile or absent gap must not make the filter a no-op or a passthrough.
  const dt = Math.min(Math.max(elapsedMs, 1), 2_000);
  let step = delta * (1 - Math.exp(-dt / HEADING_TAU_MS));
  const maxStep = (HEADING_MAX_SLEW_DEG_PER_S * dt) / 1000;
  if (Math.abs(step) > maxStep) step = Math.sign(step) * maxStep;
  return (((previous + step) % 360) + 360) % 360;
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
