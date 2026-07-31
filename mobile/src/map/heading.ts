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

/** Signed shortest turn from `from` to `to`, in (-180, 180]. */
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
