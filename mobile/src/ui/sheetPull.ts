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

/**
 * How far down the sheet really is. `pull` is how far the drag has taken it;
 * `scrolled` is how far its content has scrolled. A drag that pulls the sheet
 * down and then turns back scrolls the CONTENT (Android gives a scroll view
 * no way to hand the upward half to its parent), so the sheet is raised by
 * what the content scrolled, up to the whole pull. Guard: `sheetPull.test.ts`.
 */
export function sheetPulled({
  pull,
  scrolled,
}: {
  pull: number;
  scrolled: number;
}): number {
  return pull - Math.min(pull, Math.max(0, scrolled));
}

/**
 * Whether a change in the sheet's height puts it back at its open position.
 * Not under a finger, which has it where it wants it, and not while it is
 * closing, where the pull it was let go at is part of the slide out.
 * Guard: `sheetPull.test.ts`.
 */
export function sheetReseats({
  visible,
  touching,
}: {
  visible: boolean;
  touching: boolean;
}): boolean {
  return visible && !touching;
}
