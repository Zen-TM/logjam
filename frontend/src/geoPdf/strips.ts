/** JPEG MCU height: a strip owns a multiple of this many rows, except the last. */
export const STRIP_ROW_MULTIPLE = 16;
/**
 * Each strip but the last is drawn this many rows taller than it owns, so the
 * next strip covers the overlap and the PDF has no anti-aliased hairline. The
 * same count of rows is drawn above every strip after the first and cropped.
 */
export const STRIP_OVERLAP_ROWS = 16;
/** Below the 16.7 MP single-canvas cap of iOS Safari (16.6 MP measured on #602). */
export const STRIP_MAX_PX = 16_000_000;

export type Strip = {
  index: number;
  /** Top row in map pixels (a multiple of 16). */
  y: number;
  /** Rows this strip owns (a multiple of 16, except the last). */
  height: number;
  /** `height` plus the overlap, clipped to the map; the last strip's is its height. */
  renderHeight: number;
};

/**
 * The rows a strip's canvas has when drawn: its `renderHeight`, and for every
 * strip after the first a halo of `STRIP_OVERLAP_ROWS` above it, drawn and
 * cropped off because a canvas draws its outermost row differently (see
 * render.ts, `drawnRows`).
 */
export function canvasRows(strip: Strip): number {
  return strip.renderHeight + (strip.y > 0 ? STRIP_OVERLAP_ROWS : 0);
}

/**
 * The fewest strips that each draw within `maxStripPx` (counting `canvasRows`),
 * tiling [0, mapHeight) by `height`. A map that fits is one strip. Every strip
 * but the last owns the same height. Throws RangeError when it cannot be
 * planned: a bad size, or rows so wide that a 16-row strip plus its overlap
 * and halo (48 rows) still exceeds `maxStripPx`.
 */
export function planStrips(
  mapWidth: number,
  mapHeight: number,
  maxStripPx: number,
): Strip[] {
  if (!(mapWidth > 0 && mapHeight > 0 && maxStripPx > 0)) {
    throw new RangeError("planStrips: sizes must be positive");
  }
  const maxRows = Math.floor(maxStripPx / mapWidth);
  if (mapHeight <= maxRows) {
    return [{ index: 0, y: 0, height: mapHeight, renderHeight: mapHeight }];
  }
  // A strip's canvas is its height plus the overlap below it (not the last)
  // plus the halo above it (not the first): two strips need 16 extra rows, three
  // or more need 32 for a middle one.
  let count = 2;
  let height = 0;
  for (; ; count++) {
    height =
      Math.ceil(mapHeight / count / STRIP_ROW_MULTIPLE) * STRIP_ROW_MULTIPLE;
    const extra = count === 2 ? STRIP_OVERLAP_ROWS : 2 * STRIP_OVERLAP_ROWS;
    if (height + extra <= maxRows) break;
    // Strips cannot get shorter than one 16-row unit.
    if (height <= STRIP_ROW_MULTIPLE) {
      throw new RangeError("planStrips: map is too wide for any strip");
    }
  }
  return Array.from({ length: count }, (_, index) => {
    const y = index * height;
    const last = index === count - 1;
    const own = last ? mapHeight - y : height;
    return {
      index,
      y,
      height: own,
      renderHeight: last
        ? own
        : Math.min(own + STRIP_OVERLAP_ROWS, mapHeight - y),
    };
  });
}
