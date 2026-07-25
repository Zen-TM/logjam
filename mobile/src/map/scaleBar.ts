// Scale-bar maths. MapLibre React Native v10 exposes no scale-bar ornament
// (only compass/attribution/logo), so the bar is drawn in JS from the camera's
// zoom and latitude — these are the pure bits, unit-tested.

// Web-Mercator ground resolution at zoom 0, latitude 0: equator circumference
// (40075016.686 m) / 256 px tile.
const EQUATOR_METERS_PER_PIXEL_Z0 = 156543.03392;

// Round distances a reader can divide in their head. Ends at 500 km — beyond
// that the whole state fits on screen and the bar stops being useful.
const NICE_STEPS_M = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000,
  50_000, 100_000, 200_000, 500_000,
] as const;

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
    const meters = Math.round(maxMeters);
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
