// The weather scrubber's arithmetic, apart from the view: a finger at `x` on a
// track `width` wide over steps `first`..`last`, and back. Guard:
// scrubberMath.test.ts.

/** The step under a finger at `x` (clamped to the track). */
export function stepAtX(
  x: number,
  width: number,
  first: number,
  last: number,
): number {
  if (width <= 0 || last <= first) return first;
  const fraction = Math.min(1, Math.max(0, x / width));
  return first + Math.round(fraction * (last - first));
}

/** Where a step's thumb sits, 0 to `width`. */
export function xAtStep(
  step: number,
  width: number,
  first: number,
  last: number,
): number {
  return last <= first ? 0 : ((step - first) / (last - first)) * width;
}
