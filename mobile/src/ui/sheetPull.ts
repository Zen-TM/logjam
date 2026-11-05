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
 * Whether a finger that has just gone down on the sheet's content pins the
 * sheet for the whole drag: the content was scrolled away from its top. Such
 * a drag scrolls the content and stops at the top; it never hands on to the
 * sheet. A drag that began at the top may. Guard: `sheetPull.test.ts`.
 */
export function sheetPins({ scrolled }: { scrolled: number }): boolean {
  return scrolled > 0;
}

/**
 * How far down the sheet really is. `pull` is how far the drag has taken it;
 * `scrolled` is how far its content has scrolled. A drag that pulls the sheet
 * down and then turns back scrolls the CONTENT (Android gives a scroll view
 * no way to hand the upward half to its parent), so the sheet is raised by
 * what the content scrolled, up to the whole pull. A `pinned` sheet (see
 * `sheetPins`) is not down at all, whatever the hand-off took.
 * Guard: `sheetPull.test.ts`.
 */
export function sheetPulled({
  pull,
  scrolled,
  pinned = false,
}: {
  pull: number;
  scrolled: number;
  pinned?: boolean;
}): number {
  if (pinned) return 0;
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

/**
 * Whether the sheet keeps drawing what it drew last in place of what its
 * owner hands it now: while it closes, when the owner has already let go of
 * what it was showing. Guard: `sheetPull.test.ts`.
 */
export function sheetHolds({ visible }: { visible: boolean }): boolean {
  return !visible;
}

/**
 * Whether the sheet is known to be at its open position: its sizes and its
 * offset have been reported, and the offset is the end of the scroll. The
 * slide in waits for this. Guard: `sheetPull.test.ts`.
 */
export function sheetSeated({
  content,
  viewport,
  y,
}: {
  content: number;
  viewport: number;
  y: number;
}): boolean {
  return (
    content > 0 &&
    viewport > 0 &&
    Number.isFinite(y) &&
    content - viewport - y < 1
  );
}
