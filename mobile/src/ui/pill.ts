// Pure geometry for pill-shaped things, kept out of the components so the unit
// suite can import it without React Native (kit.test.ts).

/** The count badge on a chip: a circle for one digit, a pill for more. */
export const BADGE_SIZE = 20;

/**
 * The corner radius of a pill of a known height: exactly half of it.
 *
 * Never `radius.pill`'s 999 on a view whose background can change: RN Android
 * draws corner radii through the background drawable, so a view that gains a
 * background after it was first laid out (a chip's count badge when another
 * chip is selected) can come back square. The same lesson as the date picker's
 * day cell.
 */
export function halfRadius(height: number): number {
  return height / 2;
}
