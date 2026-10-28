/** JPEG MCU height: a strip owns a multiple of this many rows, except the last. */
export const STRIP_ROW_MULTIPLE = 16;
/**
 * Each strip but the last is drawn this many rows taller than it owns, so the
 * next strip covers the overlap and the PDF has no anti-aliased hairline.
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
 * The fewest strips that each draw within `maxStripPx`, tiling
 * [0, mapHeight) by `height`. A map that fits is one strip. Every strip but
 * the last owns the same height. Throws RangeError when it cannot be
 * planned: a bad size, or rows so wide that a 16-row strip plus its overlap
 * (32 rows) still exceeds `maxStripPx`.
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
  const ownable =
    Math.floor((maxRows - STRIP_OVERLAP_ROWS) / STRIP_ROW_MULTIPLE) *
    STRIP_ROW_MULTIPLE;
  if (ownable < STRIP_ROW_MULTIPLE) {
    throw new RangeError("planStrips: map is too wide for any strip");
  }
  const count = Math.ceil(mapHeight / ownable);
  const height =
    Math.ceil(mapHeight / count / STRIP_ROW_MULTIPLE) * STRIP_ROW_MULTIPLE;
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
