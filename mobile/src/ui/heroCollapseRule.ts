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
 * given the `distance` the hero collapses over. A hero left half-folded is
 * wrong either way: rows hidden under it, or a compact row half-faded over
 * them. At either end, or past it (overscroll), it stays where it is; halfway
 * or more goes to the collapsed end, less to the top. The list always has the
 * room to get there (`roomBelow`), so this never sends a user away from the
 * true bottom.
 *
 * Guard: heroCollapse.test.ts.
 */
export function snapTarget(input: { y: number; distance: number }): number {
  const { y, distance } = input;
  if (!(distance > 0) || y <= 0 || y >= distance) return y;
  return y < distance / 2 ? 0 : distance;
}

/**
 * The extra room a list needs at its end so it can always scroll the whole
 * `distance`: the list's rows sit under a floating header, so a list that
 * overflows its view by less than `distance` would otherwise end with the
 * header half-folded and nowhere to go. `contentHeight` is the list's own,
 * without the room this returns: reading a height that includes it makes the
 * answer depend on the answer, and a list near the threshold flips between
 * room and none for as long as it lays out. A list that does not overflow at
 * all gets none (it does not scroll, and its hero stays full).
 *
 * Guard: heroCollapse.test.ts.
 */
export function roomBelow(input: {
  contentHeight: number;
  viewHeight: number;
  distance: number;
}): number {
  const { contentHeight, viewHeight, distance } = input;
  const overflow = contentHeight - viewHeight;
  if (!(distance > 0) || !(overflow > 0.5)) return 0;
  return Math.max(0, distance - overflow);
}

/**
 * Which form of the hero can be touched or heard. While the list is moving
 * (from the finger going down until it has settled, programmatic scrolls
 * included) neither can: one is part-faded and the other not yet there, and a
 * tap that lands on a header cannot stop a fling. At rest only the form
 * showing can.
 *
 * Guard: heroCollapse.test.ts.
 */
export function heroReach(input: { collapsed: boolean; moving: boolean }): {
  full: boolean;
  compact: boolean;
} {
  const { collapsed, moving } = input;
  return { full: !moving && !collapsed, compact: !moving && collapsed };
}

/**
 * The offset that brings the row at `contentY` (in the list's content, header
 * room included) to just under the folded header, `gap` below it, or null
 * until the header has been measured and the list padded for it. A row that
 * would land with the header half-folded goes to the nearer end instead.
 *
 * Guard: heroCollapse.test.ts.
 */
export function rowTarget(input: {
  contentY: number;
  header: number;
  distance: number;
  paddedFor: number;
  gap: number;
  range: number;
}): number | null {
  const { contentY, header, distance, paddedFor, gap, range } = input;
  if (!(header > 0) || paddedFor !== header) return null;
  const folded = header - Math.max(0, distance);
  const target = Math.min(Math.max(0, contentY - folded - gap), range);
  return snapTarget({ y: target, distance });
}
