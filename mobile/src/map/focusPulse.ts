// The timing half of the "show on map" pulse — pure, so the component that
// draws it (FocusPulse.tsx) is only wiring.
//
// PRIVACY: no coordinates here, and none anywhere in the pulse: the focused
// bbox stays in component state and is never logged.

/** Three pulses over 2.5 s, then gone. Long enough to catch the eye after the
 *  camera has finished flying, short enough not to become map furniture. */
export const FOCUS_PULSE_MS = 2500;
export const FOCUS_PULSE_COUNT = 3;

/**
 * How often the pulse re-renders itself. ~31 renders over the whole animation,
 * of ONE small memoised component — MapScreen re-renders at compass cadence
 * (up to ~5/s) and must not gain a second reason to, which is why this is a local
 * interval rather than a value threaded through its render.
 */
export const FOCUS_PULSE_FRAME_MS = 80;

/**
 * Opacity at `elapsedMs`: half-sine humps, so each pulse fades up and back to
 * fully transparent rather than blinking. Ends at exactly 0 (the count is a
 * whole number of humps), so the last frame drawn is invisible and the unmount
 * that follows can't show as a snap.
 */
export function focusPulseOpacity(elapsedMs: number): number {
  if (elapsedMs <= 0 || elapsedMs >= FOCUS_PULSE_MS) return 0;
  const phase = (elapsedMs / FOCUS_PULSE_MS) * FOCUS_PULSE_COUNT * Math.PI;
  return Math.abs(Math.sin(phase));
}
