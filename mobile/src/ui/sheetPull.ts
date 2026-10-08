/** How far down a sheet is pulled before letting go closes it. */
export const DISMISS_DISTANCE = 120;

/**
 * What a sheet does once it has come to rest `pulled` points below its open
 * position with no finger on it. A flick needs no rule of its own: the fling
 * carries the sheet past the distance.
 *
 * `dragged` is whether a finger put it there. Guard: `sheetPull.test.ts`.
 */
export function sheetRelease({
  pulled,
  dragged,
}: {
  pulled: number;
  dragged: boolean;
}): "rest" | "snap" | "close" {
  if (pulled <= 0) return "rest";
  return dragged && pulled > DISMISS_DISTANCE ? "close" : "snap";
}
