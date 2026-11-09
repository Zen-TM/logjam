// Where the zoom-gated overlays start, and how they arrive. Both clients read
// these, so a layer is on at the same zoom on Logjam Web and Logjam GPS.
// Guard: overlayZoom.test.ts.

/**
 * A layer's `minzoom` stays where it is, so nothing is fetched or drawn below
 * it; its opacity ramps from 0 there to full a zoom level above, so it fades
 * in instead of popping in.
 */
export const ZOOM_FADE_LEVELS = 1;

/**
 * The slope archive's coarse zooms are the steepest of the finer pixels
 * (`halve_max` in topo/build_nsw_dem.py), so below z12 a pixel is the steepest
 * of 8 x 8 or more z15 pixels and nearly every hill reads as a cliff. It is
 * drawn from here, not from the archive's z8.
 */
export const SLOPE_MIN_ZOOM = 11;

/**
 * Fire history. A burn is kilometres across, so it reads at the zoom a person
 * picks a valley from; further out the tint covers the state in patches that
 * hide the map. Like Land, it fades in rather than drawing everywhere.
 */
export const FIRE_MIN_ZOOM = 10;

/**
 * Coverage, a level deeper than Fire history. Its gaps are a valley floor or
 * the far side of a ridge, a few hundred metres across, and the hatch shows
 * one only as lines 12 px apart: at z10 that is about 1.5 km between lines,
 * and the map is a speckle with no gap a person could plan around.
 */
export const COVERAGE_MIN_ZOOM = 11;

/** Statewide contours (the archive starts at z11, `NSW_CONTOURS`). */
export const CONTOURS_MIN_ZOOM = 12;
export const CONTOUR_LABELS_MIN_ZOOM = 13;
/** Minor contours, between the majors. */
export const CONTOURS_MINOR_MIN_ZOOM = 14;

/**
 * The river gauge drops. About 280 gauges lie across NSW: below z8 a screen
 * holds a state's worth of them and the drops are a speckle that hides the
 * pins; from z8 a screen holds tens, which is a choice.
 */
export const GAUGES_MIN_ZOOM = 8;

/**
 * An opacity expression: 0 at `minzoom`, `full` `ZOOM_FADE_LEVELS` above it. `full` is a number or an expression (a gauge's faint drop).
 */
export function zoomFadeIn(
  minzoom: number,
  full: number | unknown[] = 1,
): unknown[] {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    minzoom,
    0,
    minzoom + ZOOM_FADE_LEVELS,
    full,
  ];
}
