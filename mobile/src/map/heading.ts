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
 */
export const HEADING_TAU_MS = 450;

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
 * Course-up's camera: how often it may write a stop, and how long each stop
 * animates for.
 *
 * THE DURATION IS DELIBERATELY LONGER THAN THE INTERVAL. Matching them looks
 * right on paper — each stop finishing exactly as the next arrives — and is
 * wrong in practice: sample delivery is irregular, so an animation that is
 * merely long enough finishes early and the map SITS STILL until the next write.
 * Over a fast turn that reads as a series of bursts rather than one movement.
 * At roughly twice the interval every stop is interrupted mid-flight by the
 * next, and the camera never stops moving while the user is turning.
 *
 * The cost is bounded by the deadband below, not by these: a phone held still
 * writes nothing at all, so the renderer still goes idle. That is what stops
 * course-up being the most expensive thing on the screen, which it was when it
 * wrote a stop per sample.
 */
export const POV_CAMERA_MS = 150;
export const POV_ANIMATION_MS = 320;
/**
 * 1.5°, which is below the platform's own 2° reporting step: the smoothing
 * above is what makes that safe. The filtered bearing of a phone held still
 * wanders well under a degree, so the deadband still closes and the renderer
 * still goes idle — while a real turn crosses it on the first sample instead of
 * waiting for the second, which is what a wider deadband made POV feel like.
 */
export const POV_DEADBAND_DEG = 1.5;

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
