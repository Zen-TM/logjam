/**
 * Range selection by tapping numbered pills (a 7-stop slider inside a scrolling
 * sheet is a gesture fight with the sheet's own drag, and its thumbs are smaller
 * than a fingertip).
 *
 * One rule, applied from wherever the tap lands:
 *
 * - Nothing selected → the tapped value alone.
 * - Tapping the only selected value → cleared (back to "any").
 * - Tapping outside the range → the range grows to reach it.
 * - Tapping inside a wider range → collapses to just that value, so narrowing
 *   never needs two taps in a row that both widen.
 */
export type NumberRange = [number, number];

export function nextRange(
  current: NumberRange | null,
  tapped: number,
): NumberRange | null {
  if (current === null) return [tapped, tapped];
  const [low, high] = current;
  if (low === tapped && high === tapped) return null;
  if (tapped < low) return [tapped, high];
  if (tapped > high) return [low, tapped];
  return [tapped, tapped];
}

/** A range covering the whole axis filters nothing, so it reads as "any". */
export function isFullRange(
  range: NumberRange | null,
  bounds: readonly [number, number],
): boolean {
  if (range === null) return true;
  return range[0] <= bounds[0] && range[1] >= bounds[1];
}

/** A range as text: "Any" for the whole axis, else "2–4". `word` writes each
 *  end (a labelled field's words, "A–C1"); the number by default. */
export function formatRange(
  range: NumberRange | null,
  bounds: readonly [number, number],
  prefix = "",
  word: (stop: number) => string = String,
): string {
  if (isFullRange(range, bounds)) return "Any";
  const [low, high] = range as NumberRange;
  return low === high
    ? `${prefix}${word(low)}`
    : `${prefix}${word(low)}–${prefix}${word(high)}`;
}
