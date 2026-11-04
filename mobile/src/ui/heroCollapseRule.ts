/** Scrolled this far, the full hero gives way; back at the top, it returns. */
export const COLLAPSE_AT = 32;
export const EXPAND_AT = 4;

/** The compact hero's row, before the safe-area inset the full hero shares. */
export const COMPACT_ROW = 56;

/** "Places · 36": the page's name, then its count. */
export function compactHeroTitle(name: string, count: number): string {
  return `${name} · ${count}`;
}

/**
 * Whether a list's pinned hero is compact, given where the list is.
 *
 * Swapping the hero changes the list's own height, and the platform may move
 * the scroll offset by what the hero gave up or took (it clamps, or keeps the
 * rows where they were). So the two thresholds must hold either way, or the
 * swap itself crosses the other one and the hero flaps:
 *
 * - it collapses only once the list has scrolled past what the hero gives up
 *   (`gives`) plus COLLAPSE_AT, so an offset that drops by `gives` is still
 *   past EXPAND_AT, and the list would still scroll afterwards (else it would
 *   clamp to the top and expand the hero again);
 * - it expands at the top (EXPAND_AT), or when the list no longer overflows
 *   its view (a search narrowed it), when there is nothing left to scroll back
 *   with. An offset that grows by `gives` after that stays under the collapse
 *   line. Between the two it stays as it was.
 *
 * Guard: heroCollapse.test.ts simulates both offset moves.
 */
export function nextCompact(input: {
  compact: boolean;
  y: number;
  contentHeight: number;
  viewHeight: number;
  fullHeight: number;
  compactHeight: number;
}): boolean {
  const { compact, y, contentHeight, viewHeight } = input;
  const overflow = contentHeight - viewHeight;
  if (compact) return !(y <= EXPAND_AT || overflow <= 0);
  const gives = Math.max(0, input.fullHeight - input.compactHeight);
  return y > gives + COLLAPSE_AT && overflow > gives + COLLAPSE_AT;
}
