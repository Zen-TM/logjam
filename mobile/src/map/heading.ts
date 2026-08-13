// Compass-heading smoothing. The magnetometer streams ~10 Hz and its raw
// output wobbles by several degrees while the phone is held still, which is
// invisible on a static dot and unbearable once the map itself rotates to the
// heading (POV mode) — the whole world shivers.
//
// The old approach (throttle to 200 ms, ignore changes under 3°) made it worse:
// it removed the small wobble and kept the big one, so the arrow sat still and
// then jumped 3°. This filters instead of gating — an exponential average that
// converges on the true bearing rather than snapping to samples.

/**
 * How often the smoothed heading is allowed to reach React (and the camera).
 * The sensor runs at ~10 Hz; 50 ms is 20 fps, which looks continuous and
 * halves the renders. It doubles as the camera's animation duration in POV
 * mode, so each rotation finishes exactly as the next one arrives — any gap
 * shows up as a stutter, any overlap as a fight.
 */
export const HEADING_RENDER_MS = 50;

/** Signed shortest turn from `from` to `to`, in [-180, 180). */
export function shortestAngleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * Weight of each new sample. 0.2 at ~10 Hz settles a 30° turn in about half a
 * second while flattening the ±3° standstill wobble. Higher feels twitchy;
 * lower lags behind a real turn of the body.
 */
export const HEADING_SMOOTHING = 0.2;

/**
 * Fold one sample into the running average, the long way round never taken:
 * averaging 359° and 1° in plain degrees gives 180°, which points the arrow
 * backwards exactly when the user is walking north.
 *
 * A big jump is followed immediately rather than crawled towards — that is a
 * real turn (or a recalibration), not sensor noise, and lagging a second
 * behind a spin is more disorienting than the jump.
 */
export function smoothHeading(previous: number | null, sample: number): number {
  const wrapped = ((sample % 360) + 360) % 360;
  if (previous == null) return wrapped;
  const delta = shortestAngleDelta(previous, wrapped);
  if (Math.abs(delta) > 90) return wrapped;
  return (((previous + delta * HEADING_SMOOTHING) % 360) + 360) % 360;
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
