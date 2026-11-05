// How the slope bands are edited, for both clients (the Terrain group's
// "Slope bands" view on Logjam Web and on Logjam GPS). The bands stay a
// contiguous, ascending cover of whole degrees (`slopeBandsError`), and every
// colour is painted along two scale ends, so no edit leaves a hole in the ramp.
// Tests: slopeBandsEdit.test.ts.
import {
  applySlopeGradient,
  MAX_SLOPE_BANDS,
  RASTER_TEMPLATE_DEFAULTS,
  slopeBandsError,
  type SlopeBand,
} from "./topoSettings.js";

const DEFAULT_INSERT_WIDTH = 10;
// Replaced by the scale at once; only here so an insert is a valid band.
const NEW_BAND_COLOUR = "#ff000080";

/** The two ends of the shipped default ramp: what "Reset colours" goes back to. */
export const DEFAULT_SLOPE_SCALE = {
  start: RASTER_TEMPLATE_DEFAULTS.slope.bands[0].colour,
  end: RASTER_TEMPLATE_DEFAULTS.slope.bands[
    RASTER_TEMPLATE_DEFAULTS.slope.bands.length - 1
  ].colour,
};

/**
 * The colours Logjam GPS offers for a scale end: a phone has no free colour
 * picker, so it chooses from a closed list (opacity stays what the end had).
 */
export const SLOPE_SCALE_COLOURS = [
  "#ffff00",
  "#ffa500",
  "#dc2626",
  "#780000",
  "#c026d3",
  "#2563eb",
  "#16a34a",
  "#000000",
] as const;

/** The bands' two ends: the shallowest band's colour and the steepest's. */
export function slopeScale(bands: SlopeBand[]): {
  start: string;
  end: string;
} {
  return { start: bands[0].colour, end: bands[bands.length - 1].colour };
}

/** Repaint `bands` along a scale (`applySlopeGradient`, named for the editor). */
export function setSlopeScale(
  bands: SlopeBand[],
  start: string,
  end: string,
): SlopeBand[] {
  return applySlopeGradient(bands, start, end);
}

/** One scale end in a new RGB colour (`#rrggbb`), keeping that end's opacity. */
export function setSlopeScaleColour(
  bands: SlopeBand[],
  which: "start" | "end",
  rgb: string,
): SlopeBand[] {
  const scale = slopeScale(bands);
  const next = `${rgb.slice(0, 7)}${scale[which].slice(7)}`;
  return which === "start"
    ? setSlopeScale(bands, next, scale.end)
    : setSlopeScale(bands, scale.start, next);
}

// Restructured bands are recoloured along the scale they had, so an insert, a
// removal or a boundary edit keeps a clean fade.
function recolour(before: SlopeBand[], after: SlopeBand[]): SlopeBand[] {
  const { start, end } = slopeScale(before);
  return applySlopeGradient(after, start, end);
}

/** The transparency threshold: the lowest band's lower angle. */
export function setSlopeThreshold(
  bands: SlopeBand[],
  deg: number,
): SlopeBand[] {
  return recolour(
    bands,
    bands.map((b, i) => (i === 0 ? { ...b, fromDeg: deg } : b)),
  );
}

/** Band `idx`'s upper angle, which is also the next band's lower angle. */
export function setSlopeUpper(
  bands: SlopeBand[],
  idx: number,
  deg: number,
): SlopeBand[] {
  const next = bands.map((b) => ({ ...b }));
  next[idx].toDeg = deg;
  if (idx < next.length - 1) next[idx + 1].fromDeg = deg;
  return recolour(bands, next);
}

export function removeSlopeBand(bands: SlopeBand[], idx: number): SlopeBand[] {
  const next = bands.filter((_, i) => i !== idx).map((b) => ({ ...b }));
  // An interior band's gap closes by extending the band below it up to the next.
  if (idx > 0 && idx < next.length) next[idx - 1].toDeg = next[idx].fromDeg;
  return recolour(bands, next);
}

/**
 * The whole degrees a boundary may take: `"threshold"` or band `idx`'s upper
 * angle. Any whole number in it keeps the bands valid.
 */
export function slopeBoundaryRange(
  bands: SlopeBand[],
  boundary: "threshold" | number,
): { min: number; max: number } {
  if (boundary === "threshold") return { min: 0, max: bands[0].toDeg - 1 };
  return {
    min: bands[boundary].fromDeg + 1,
    max: boundary < bands.length - 1 ? bands[boundary + 1].toDeg - 1 : 90,
  };
}

/**
 * Insert a band at `position` (0..bands.length), or null when there is no room.
 *  - 0: a new lowest band below the transparency threshold (lowers it).
 *  - bands.length: a new top band toward 90°; if the top is already 90° it
 *    carves room from the current last band instead.
 *  - interior: splits the shared boundary, taking the width from the neighbour
 *    with more room while keeping every band at least 1°.
 */
export function insertSlopeBand(
  bands: SlopeBand[],
  position: number,
): SlopeBand[] | null {
  if (bands.length >= MAX_SLOPE_BANDS) return null;
  const next = bands.map((b) => ({ ...b }));

  if (position <= 0) {
    const top = next[0].fromDeg;
    if (top <= 0) return null;
    next.unshift({
      fromDeg: Math.max(0, top - DEFAULT_INSERT_WIDTH),
      toDeg: top,
      colour: NEW_BAND_COLOUR,
    });
    return recolour(bands, next);
  }

  if (position >= bands.length) {
    const last = next[next.length - 1];
    if (last.toDeg < 90) {
      next.push({
        fromDeg: last.toDeg,
        toDeg: Math.min(90, last.toDeg + DEFAULT_INSERT_WIDTH),
        colour: NEW_BAND_COLOUR,
      });
      return recolour(bands, next);
    }
    const width = Math.min(DEFAULT_INSERT_WIDTH, last.toDeg - last.fromDeg - 1);
    if (width < 1) return null;
    last.toDeg = 90 - width;
    next.push({ fromDeg: 90 - width, toDeg: 90, colour: NEW_BAND_COLOUR });
    return recolour(bands, next);
  }

  const left = next[position - 1];
  const right = next[position];
  const boundary = left.toDeg;
  const leftSpan = left.toDeg - left.fromDeg;
  const rightSpan = right.toDeg - right.fromDeg;
  const width = Math.min(
    DEFAULT_INSERT_WIDTH,
    Math.max(1, Math.floor(Math.max(leftSpan, rightSpan) / 2)),
    (rightSpan >= leftSpan ? rightSpan : leftSpan) - 1,
  );
  if (width < 1) return null;
  if (rightSpan >= leftSpan) {
    right.fromDeg = boundary + width;
    next.splice(position, 0, {
      fromDeg: boundary,
      toDeg: boundary + width,
      colour: NEW_BAND_COLOUR,
    });
  } else {
    left.toDeg = boundary - width;
    next.splice(position, 0, {
      fromDeg: boundary - width,
      toDeg: boundary,
      colour: NEW_BAND_COLOUR,
    });
  }
  return recolour(bands, next);
}

/**
 * What a client holds while the user edits: the bands as the editor shows them
 * (mid-edit problems and all) and the last of them the map can draw and the
 * account can keep. The editor commits per change, so an in-between state, such
 * as a threshold field emptied to be retyped, never reaches the map or the save.
 */
export type SlopeBandsEdit = {
  bands: SlopeBand[];
  lastValid: SlopeBand[] | null;
};

export function nextSlopeBandsEdit(
  prev: SlopeBandsEdit | null,
  bands: SlopeBand[],
): SlopeBandsEdit {
  return {
    bands,
    lastValid:
      slopeBandsError(bands) == null ? bands : (prev?.lastValid ?? null),
  };
}
