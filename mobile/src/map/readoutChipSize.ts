// How big the speed and elevation chip is at a system text size. Pure, so a
// test can hold it; the chip and MapScreen's compass margin both read it.

/** The floor width at the default text size: wide enough for "12.5 km/h", "1234 m"
 *  and "12 min ago" without the columns touching. A glance figure, not a hero. */
export const CHIP_MIN_WIDTH = 168;

/** The chip's width: the two columns split it evenly, so the text size sets how
 *  wide each may be. At 1.5x "0.0 km/h" was cut to "0.0 km…" in a fixed 168.
 *  `textScale` is Logjam's own multiplier, `fontScale` the system's. */
export function readoutChipMinWidth(
  fontScale: number,
  textScale: number,
): number {
  return Math.round(CHIP_MIN_WIDTH * Math.max(1, textScale * fontScale));
}

/** The chip's height: its two text lines grow with the system's `fontScale`,
 *  the padding does not. The compass ornament's margin reads this. */
export function readoutChipHeight(
  linesHeight: number,
  padding: number,
  fontScale: number,
): number {
  return Math.round(linesHeight * Math.max(1, fontScale)) + padding;
}
