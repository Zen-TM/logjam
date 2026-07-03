import { DateTime } from "luxon";

export const SYDNEY_TZ = "Australia/Sydney";

/** Returns the start of the current month (1st 00:00 Sydney time). */
export function currentMonthStart(now = new Date()): Date {
  return DateTime.fromJSDate(now, { zone: SYDNEY_TZ }).startOf("month").toJSDate();
}

/** Returns the 1st of next month 00:00 Sydney time (when the quota resets). */
export function nextMonthReset(now = new Date()): Date {
  return DateTime.fromJSDate(now, { zone: SYDNEY_TZ })
    .startOf("month")
    .plus({ months: 1 })
    .toJSDate();
}

/**
 * Largest typical ELVIS LiDAR tile footprint (km²). ELVIS tiles are axis-aligned
 * MGA/UTM squares with no size encoded in the repo; NSW deliveries run ~1–4 km².
 * We assume the LARGEST typical size so the draw-time estimate is conservative —
 * it yields the FEWEST tiles for a given area, so the quota warning only fires when
 * an area is clearly oversized. The authoritative count comes from the uploaded ELVIS ZIP.
 */
export const MAX_TYPICAL_ELVIS_TILE_KM2 = 4;

/** Conservative lower-bound estimate of ELVIS tiles a drawn area would consume. */
export function estimateElvisTileCount(areaKm2: number): number {
  if (!Number.isFinite(areaKm2) || areaKm2 <= 0) return 0;
  return Math.ceil(areaKm2 / MAX_TYPICAL_ELVIS_TILE_KM2);
}
