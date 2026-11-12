// Camera zoom to ground scale, and the scale bar drawn from it. MapLibre React
// Native v10 exposes no scale-bar ornament (only compass/attribution/logo), so
// the bar is drawn in JS from the camera's zoom and latitude — these are the
// pure bits, unit-tested.
//
// Camera zoom → ground metres per DP is `metersPerPixel` in @logjam/shared,
// which both clients' maps use; this file holds the 256-based tile variant
// and the conversions only Logjam GPS needs.

import { MAP_WORLD_PX_Z0 } from "@logjam/shared";

// Web-Mercator ground resolution at zoom 0, latitude 0, for the SLIPPY-TILE
// convention (256-based) — deliberately a separate constant from the 512-based
// one behind `metersPerPixel` in @logjam/shared.
const EQUATOR_METERS_PER_PIXEL_TILE_Z0 = 156543.03392;

/**
 * Ground metres per pixel at a slippy-tile zoom (256-based XYZ tile
 * coordinates), NOT a MapLibre camera zoom — use `metersPerPixel` (shared) for
 * that. Sole caller: `regionFrame.ts`'s region-download size/detail estimate,
 * which plans against standard tile zooms. Mixing the two conventions
 * doubles or halves the ground resolution — do not inline this formula
 * a third time.
 */
export function tileMetersPerPixel(latitudeDeg: number, zoom: number): number {
  return (
    (EQUATOR_METERS_PER_PIXEL_TILE_Z0 *
      Math.cos((latitudeDeg * Math.PI) / 180)) /
    2 ** zoom
  );
}

/**
 * Degrees of latitude per DP at `zoom` — the tolerance converter for hit tests
 * that compare in degrees (`anchorHit.ts`, the line-grab reach).
 *
 * DP, not physical pixels: MapLibre Native is handed the view size divided by
 * the display density, so its own screen space is density-independent and its
 * zoom is the 512-based camera zoom. Dividing by `PixelRatio.get()` or using 256
 * would shrink the reach below the handle it is meant to extend.
 *
 * Longitude is not corrected for latitude: over tens of DP the foreshortening
 * at NSW latitudes is far below the precision these decisions need, and the
 * callers compare planar degrees for the same reason (`nearestSegment`).
 */
export function degreesPerDp(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom < 0) {
    throw new Error(`degreesPerDp: zoom out of range (${zoom})`);
  }
  return 360 / (MAP_WORLD_PX_Z0 * 2 ** zoom);
}

// Round distances a reader can divide in their head. Ends at 500 km — beyond
// that the whole state fits on screen and the bar stops being useful.
const NICE_STEPS_M = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000,
  50_000, 100_000, 200_000, 500_000,
] as const;

export type ScaleBarStep = {
  /** Ground distance the bar represents. */
  meters: number;
  /** On-screen width to draw, always <= the space offered. */
  widthPx: number;
  /** Reader-facing label, e.g. "500 m" / "2 km". */
  label: string;
};

/**
 * Largest round ground distance that fits the offered width. Never returns a
 * bar wider than `maxWidthPx`: if even the smallest step overflows (absurdly
 * zoomed out on a tiny viewport) the bar is clamped to the space available and
 * the label still states the true distance of the clamped width.
 */
export function chooseScaleStep(
  metersPerPixelValue: number,
  maxWidthPx: number,
): ScaleBarStep {
  if (!Number.isFinite(metersPerPixelValue) || metersPerPixelValue <= 0) {
    throw new Error(
      `chooseScaleStep: bad metersPerPixel (${metersPerPixelValue})`,
    );
  }
  if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) {
    throw new Error(`chooseScaleStep: bad maxWidthPx (${maxWidthPx})`);
  }

  const maxMeters = metersPerPixelValue * maxWidthPx;
  const fitting = NICE_STEPS_M.filter((step) => step <= maxMeters);
  if (fitting.length === 0) {
    // Never label the bar "0 m": below half a metre the rounding would wipe
    // the number out entirely and the bar would claim no scale at all.
    const meters = Math.max(1, Math.round(maxMeters));
    return { meters, widthPx: maxWidthPx, label: formatScaleLabel(meters) };
  }
  const meters = fitting[fitting.length - 1]!;
  return {
    meters,
    widthPx: meters / metersPerPixelValue,
    label: formatScaleLabel(meters),
  };
}

function formatScaleLabel(meters: number): string {
  if (meters >= 1_000) {
    const km = meters / 1_000;
    return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
  }
  return `${meters} m`;
}
