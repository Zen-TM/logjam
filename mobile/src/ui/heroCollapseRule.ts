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
 * It collapses only when the list would still scroll once the hero hands back
 * its height: otherwise the list would clamp to the top and expand the hero
 * again, over and over. It expands at the top, or whenever the list no longer
 * overflows its view (a search narrowed it), when there is nothing left to
 * scroll back with. Between EXPAND_AT and COLLAPSE_AT it stays as it was.
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
  return y > COLLAPSE_AT && overflow > gives + COLLAPSE_AT;
}
