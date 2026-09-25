// The timing/distance rule behind the map's own double-tap zoom.
//
// MapLibre's zoom gestures are off for the whole of follow mode
// (`zoomEnabled={followMode === "off"}` in MapScreen) because this screen
// drives the pinch itself — and that took double-tap-to-zoom with it, since it
// is one of MapLibre's zoom gestures rather than a separate press handler.
// Handing zoom back is not an option (two drivers on the same two fingers is
// what made follow mode let go mid-pinch — see useMapPinchGesture), so the
// gesture is recognised here instead.
//
// Pure and separate so the rule is testable without a device, same as
// useMapPinchGesture's maths and heading.ts.

/**
 * Longest gap between the two taps. Android's own `ViewConfiguration`
 * double-tap timeout is 300 ms and MapLibre uses the platform detector, so
 * matching it keeps the gesture feeling identical to the one it replaces.
 */
export const DOUBLE_TAP_MS = 300;

/**
 * How far the second tap may land from the first. Larger than a touch slop
 * (8dp) on purpose: these are two separate taps, so the finger lifts and
 * re-lands rather than sliding, and ~30 px is about the spread of a deliberate
 * double tap by a thumb on a phone held one-handed.
 */
export const DOUBLE_TAP_SLOP_PX = 30;

export type TapSample = { x: number; y: number; timeMs: number };

/**
 * Whether `next` completes a double tap begun at `previous`. Both bounds have
 * to hold: two taps a second apart are two questions about two spots, and two
 * taps 200 px apart are as well.
 */
export function isDoubleTap(previous: TapSample | null, next: TapSample): boolean {
  if (!previous) return false;
  const gap = next.timeMs - previous.timeMs;
  if (gap < 0 || gap > DOUBLE_TAP_MS) return false;
  return Math.hypot(next.x - previous.x, next.y - previous.y) <= DOUBLE_TAP_SLOP_PX;
}

/**
 * The double-tap zoom ramp, in course-up.
 *
 * A single 200 ms `setCameraStop` (one zoom, one centre) was the original
 * shape, and it visibly translated the map: MapLibre interpolates centre
 * LINEARLY between the two stops while zoom moves EXPONENTIALLY (metres per
 * pixel halves per level), and course-up's centre is offset from the fix by
 * an amount that itself depends on zoom (`povCameraCenter`), so the two
 * endpoints' centres differ by a few hundred metres and the marker slid
 * across the screen and back. Stepping the zoom in short ticks — recomputing
 * the offset centre at each intermediate zoom, same as `tickHeading` steps
 * the compass — confines that mismatch to one tick's travel instead of the
 * whole gesture, which is what holds the marker still.
 *
 * The ramp is also the ONLY camera writer while it runs: the heading ticker
 * stands down for its duration and the ramp's own stops carry the bearing. Two
 * streams of stops do not blend — each cancels the other's transition — so a
 * bearing-only stream interleaved with a zoom-only one is two mechanisms
 * fighting over the same camera.
 *
 * That was necessary and not sufficient: making the ramp the only writer still
 * left it ANIMATING each step, and an animated stop per tick cancels the ease
 * in flight and restarts a new one from wherever it had reached — a restart
 * every tick, which on a real device still read as jitter. The ramp now jumps
 * the camera per FRAME with `duration: 0`, which is how the pinch has always
 * driven the same two properties smoothly (`useMapPinchGesture`): with no
 * animation there is nothing to cancel. There is no tick constant any more —
 * the display's frame clock is the cadence.
 */
export const ZOOM_RAMP_MS = 200;

/**
 * The zoom the ramp should be at `elapsedMs` into a `durationMs` linear climb
 * from `startZoom` to `targetZoom`. Exact at both ends — the caller writes
 * this straight into `zoomRef`, so a rounding artefact at the finish would
 * leave the next pinch starting from the wrong level.
 */
export function zoomRampValue(
  startZoom: number,
  targetZoom: number,
  elapsedMs: number,
  durationMs: number,
): number {
  if (elapsedMs <= 0) return startZoom;
  if (elapsedMs >= durationMs) return targetZoom;
  return startZoom + (targetZoom - startZoom) * (elapsedMs / durationMs);
}
