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
