/** "Places · 36": the page's name, then its count. */
export function compactHeroTitle(name: string, count: number): string {
  return `${name} · ${count}`;
}

/** With reduced motion the swap happens inside this last stretch of the
 *  collapse, so it reads as instant; nothing slides or fades before it. */
export const STEP_PX = 1;

export type Ramp = { inputRange: number[]; outputRange: number[] };

/** `from` until `start`, `to` by `end` (both fractions of the collapse
 *  distance), a straight line between. The caller clamps outside the range. */
function ramp(
  distance: number,
  [start, end]: [number, number],
  [from, to]: [number, number],
): Ramp {
  const a = start * distance;
  const b = end * distance;
  return a > 0
    ? { inputRange: [0, a, b], outputRange: [from, from, to] }
    : { inputRange: [0, b], outputRange: [from, to] };
}

const REST = (value: number): Ramp => ({
  inputRange: [0, 1],
  outputRange: [value, value],
});

/**
 * How the pinned header follows the list's scroll offset `y`, over the
 * `distance` the full hero gives up to the compact row (full height minus
 * compact height). Nothing here changes layout, so the native driver runs it:
 *
 * - `slide`: the header block (full hero and the pinned rows) rides up with
 *   the list, 1:1, so the rows under it keep pace with the finger;
 * - `counterSlide`: the compact row cancels `slide`, so it stays at the top;
 * - `full` / `compact`: the full hero fades out over the first 60% and the
 *   compact row fades in over the last 60%, so they cross in the middle.
 *
 * Reduced motion: every channel changes inside the last `STEP_PX` before
 * `distance`, so the swap is instant and lands as the rows reach the compact
 * row (until then they slide under the still-full hero).
 *
 * Guard: heroCollapse.test.ts.
 */
export function collapseRanges(distance: number, reduceMotion: boolean) {
  if (!(distance > 0))
    return {
      slide: REST(0),
      counterSlide: REST(0),
      full: REST(1),
      compact: REST(0),
    };
  const at = (start: number, end: number): [number, number] =>
    reduceMotion ? [(distance - STEP_PX) / distance, 1] : [start, end];
  return {
    slide: ramp(distance, at(0, 1), [0, -distance]),
    counterSlide: ramp(distance, at(0, 1), [0, distance]),
    full: ramp(distance, at(0, 0.6), [1, 0]),
    compact: ramp(distance, at(0.4, 1), [0, 1]),
  };
}

/**
 * Where a list should come to rest when the finger lets go at offset `y`,
 * given the `distance` the hero collapses over and the list's `range` (how far
 * it can scroll at all). A hero left half-folded is wrong either way: rows
 * hidden under it, or a compact row half-faded over them.
 *
 * - at either end, or past it (overscroll), it stays where it is;
 * - halfway or more goes to the collapsed end, less to the top;
 * - a list that cannot scroll the whole distance goes to the top: it could
 *   never finish the collapse.
 *
 * Guard: heroCollapse.test.ts.
 */
export function snapTarget(input: {
  y: number;
  distance: number;
  range: number;
}): number {
  const { y, distance, range } = input;
  if (!(distance > 0) || y <= 0 || y >= distance) return y;
  if (range < distance) return 0;
  return y < distance / 2 ? 0 : distance;
}
