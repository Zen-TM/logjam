// Camera zoom to ground scale, and the scale bar drawn from it. MapLibre React
// Native v10 exposes no scale-bar ornament (only compass/attribution/logo), so
// the bar is drawn in JS from the camera's zoom and latitude — these are the
// pure bits, unit-tested.
//
// This file is where the 512 lives (see below): the scale bar is the one place
// the convention is VISIBLY wrong when it is wrong, so anything else needing
// zoom→ground takes it from here rather than writing its own power of two.

// Web-Mercator ground resolution at zoom 0, latitude 0.
//
// MapLibre's camera zoom is 512-BASED: the world is `512 · 2^zoom` points
// across, not `256 · 2^zoom` (the slippy-tile convention). A raster source
// declaring `tileSize: 256` is served its z+1 tiles to compensate, but the
// number `onRegionDidChange` reports is still the 512-based one — so the bar
// must divide by 512, and the 256-based 156543.034 constant this used made
// every distance read exactly double.
export const MAP_WORLD_DP_Z0 = 512;

const EQUATOR_METERS_PER_PIXEL_Z0 = 40075016.686 / MAP_WORLD_DP_Z0;

// Round distances a reader can divide in their head. Ends at 500 km — beyond
// that the whole state fits on screen and the bar stops being useful.
const NICE_STEPS_M = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000,
  50_000, 100_000, 200_000, 500_000,
] as const;

/**
 * Ground metres per pixel at a MapLibre CAMERA zoom (512-based — see the file
 * header). For a slippy-tile zoom (256-based, e.g. `regionFrame.ts`'s
 * download-size estimates), use `tileMetersPerPixel` below instead — the two
 * are off by exactly 2x and neither may stand in for the other.
 */
export function metersPerPixel(latitudeDeg: number, zoom: number): number {
  if (!Number.isFinite(latitudeDeg) || Math.abs(latitudeDeg) > 90) {
    throw new Error(`metersPerPixel: latitude out of range (${latitudeDeg})`);
  }
  if (!Number.isFinite(zoom) || zoom < 0) {
    throw new Error(`metersPerPixel: zoom out of range (${zoom})`);
  }
  return (
    (EQUATOR_METERS_PER_PIXEL_Z0 * Math.cos((latitudeDeg * Math.PI) / 180)) /
    2 ** zoom
  );
}

// Web-Mercator ground resolution at zoom 0, latitude 0, for the SLIPPY-TILE
// convention (256-based) — deliberately a separate constant from
// EQUATOR_METERS_PER_PIXEL_Z0 above, which is 512-based.
const EQUATOR_METERS_PER_PIXEL_TILE_Z0 = 156543.03392;

/**
 * Ground metres per pixel at a slippy-tile zoom (256-based XYZ tile
 * coordinates), NOT a MapLibre camera zoom — use `metersPerPixel` above for
 * that. Sole caller: `regionFrame.ts`'s region-download size/detail estimate,
 * which plans against standard tile zooms. Mixing the two conventions is
 * exactly the MMO-001 bug (see scaleBar's file header) — don't inline this
 * formula a third time.
 */
export function tileMetersPerPixel(latitudeDeg: number, zoom: number): number {
  return (
    (EQUATOR_METERS_PER_PIXEL_TILE_Z0 * Math.cos((latitudeDeg * Math.PI) / 180)) /
    2 ** zoom
  );
}

/**
 * Degrees of latitude per DP at `zoom` — the tolerance converter for hit tests
 * that compare in degrees (`anchorHit.ts`, the line-grab reach).
 *
 * DP, not physical pixels: MapLibre Native is handed the view size divided by
 * the display density, so its own screen space is density-independent and its
 * zoom is the 512-based one above. The anchor hit test used to divide by
 * `PixelRatio.get()` AND use 256, which on a 2.625x screen left a 20 dp reach
 * of about 15 dp — smaller than the 17 dp handle it was meant to extend, so it
 * could never fire at all.
 *
 * Longitude is not corrected for latitude: over tens of DP the foreshortening
 * at NSW latitudes is far below the precision these decisions need, and the
 * callers compare planar degrees for the same reason (`nearestSegment`).
 */
export function degreesPerDp(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom < 0) {
    throw new Error(`degreesPerDp: zoom out of range (${zoom})`);
  }
  return 360 / (MAP_WORLD_DP_Z0 * 2 ** zoom);
}

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
    throw new Error(`chooseScaleStep: bad metersPerPixel (${metersPerPixelValue})`);
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
