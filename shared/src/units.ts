// Writes a distance, height, speed, area, temperature, rain or wind figure in
// metric or imperial. It converts at display and at input and never changes a
// stored value: a distance is metres, a forecast is km/h, mm and °C, before and
// after. A gauge reading has no formatter here, because it is the agency's own
// number; a contour label and a source's resolution are `formatFixedMetres`,
// which never converts.
//
// The unit is module-level state, set with `setDisplayUnits` (metric until a
// client sets it), so a formatter takes no unit parameter (ADR 0020: the
// decision is shared, each client draws it). A formatter returns the value and
// its unit as one string.
// Test: `units.test.ts` holds the metric output to what Logjam wrote before.

import { formatNumber } from "./numberFormat.js";
import { accountRegion, REGIONS, type Region } from "./regions.js";

export type Units = "metric" | "imperial";

export const METRES_PER_FOOT = 0.3048;
export const METRES_PER_MILE = 1609.344;
const KM_PER_MILE = METRES_PER_MILE / 1000;
const KM2_PER_SQ_MI = KM_PER_MILE * KM_PER_MILE;
const MM_PER_INCH = 25.4;
const MPS_PER_MPH = METRES_PER_MILE / 3600;

/** Imperial distances read in feet below this, in miles from it: 0.1 mi. */
const FEET_BELOW_METRES = 0.1 * METRES_PER_MILE;

// A rain or wind figure and its unit are joined by a no-break space, so a
// narrow weather card or a large font never strands the unit on a line of its
// own. Every other figure here uses a plain space. Tests: `units.test.ts`, the
// metric sweep and "imperial" (literal strings in both).
const NBSP = "\u00a0";

const UNKNOWN = "—";

let current: Units = "metric";

/** Each client calls this at start and when the setting changes. */
export function setDisplayUnits(units: Units): void {
  current = units;
}

export function displayUnits(): Units {
  return current;
}

const imperial = (): boolean => current === "imperial";

/** "m" or "ft": the suffix of a length input. */
export function lengthUnitLabel(): string {
  return imperial() ? "ft" : "m";
}

/** What the user typed in a length field, as metres. */
export function lengthFromInput(value: number): number {
  return imperial() ? value * METRES_PER_FOOT : value;
}

/** Metres as the length field shows them, unrounded: the form rounds. */
export function lengthToInput(metres: number): number {
  return imperial() ? metres / METRES_PER_FOOT : metres;
}

/** Metres under 1 km, else km with one decimal; feet under 0.1 mi, else miles. */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return UNKNOWN;
  if (imperial()) {
    if (metres < FEET_BELOW_METRES)
      return `${formatNumber(Math.round(metres / METRES_PER_FOOT), 0)} ft`;
    return `${formatNumber(metres / METRES_PER_MILE, 1)} mi`;
  }
  if (metres < 1000) return `${formatNumber(Math.round(metres), 0)} m`;
  return `${formatNumber(metres / 1000, 1)} km`;
}

/** A height, or any length read in whole metres or feet (a GPS accuracy). */
export function formatHeight(metres: number): string {
  return imperial()
    ? `${formatNumber(Math.round(metres / METRES_PER_FOOT), 0)} ft`
    : `${formatNumber(Math.round(metres), 0)} m`;
}

/** The lowest and highest ground under a line, "412–655 m": one unit after both. */
export function formatHeightRange(
  minMetres: number,
  maxMetres: number,
): string {
  const [low, high] = [minMetres, maxMetres].map((metres) =>
    formatNumber(Math.round(imperial() ? metres / METRES_PER_FOOT : metres), 0),
  );
  return `${low}–${high} ${lengthUnitLabel()}`;
}

/** The two sides of a box in whole km or mi, "18 × 11 km": one unit after both. */
export function formatBoxSize(widthKm: number, heightKm: number): string {
  const [width, height] = [widthKm, heightKm].map((km) =>
    formatNumber(Math.round(imperial() ? km / KM_PER_MILE : km), 0),
  );
  return `${width} × ${height} ${imperial() ? "mi" : "km"}`;
}

/**
 * A length that is metres in every setting, written tight ("1200m"): a contour
 * line's label (the lines are every 10 m of height) and a source file's
 * resolution. It is never converted.
 */
export function formatFixedMetres(metres: number): string {
  return `${metres}m`;
}

/** Speed with one decimal. Null (no timestamps) reads as unknown. */
export function formatSpeed(mps: number | null): string {
  if (mps == null || !Number.isFinite(mps) || mps < 0) return UNKNOWN;
  return imperial()
    ? `${formatNumber(mps / MPS_PER_MPH, 1)} mph`
    : `${formatNumber(mps * 3.6, 1)} km/h`;
}

/**
 * A drawn-area size. Under 10 of the unit keeps two decimals so a small draw
 * is visibly registered instead of reading "0"; from 10 up it rounds to whole;
 * what would still show 0.00 reads "<0.01". Throws on a negative or non-finite
 * area: a caller passing one has a bug to see.
 */
export function formatArea(km2: number): string {
  if (!Number.isFinite(km2) || km2 < 0) {
    throw new Error(`formatArea: invalid area ${km2}`);
  }
  const unit = imperial() ? "sq mi" : "km²";
  const area = imperial() ? km2 / KM2_PER_SQ_MI : km2;
  if (area >= 10) return `${formatNumber(area, 0)} ${unit}`;
  if (area > 0 && area < 0.005) return `<0.01 ${unit}`;
  return `${formatNumber(area, 2)} ${unit}`;
}

/** Whole degrees, "14°": the scale is the display's, not spelled out. */
export function formatTemperature(celsius: number): string {
  return `${temperatureDegrees(celsius)}°`;
}

/** "4–17°" for a day's low and high. */
export function formatTemperatureRange(
  minCelsius: number,
  maxCelsius: number,
): string {
  return `${temperatureDegrees(minCelsius)}–${temperatureDegrees(maxCelsius)}°`;
}

function temperatureDegrees(celsius: number): string {
  const degrees = imperial() ? (celsius * 9) / 5 + 32 : celsius;
  return formatNumber(Math.round(degrees), 0);
}

/** Rain: one decimal under 1 mm, else whole mm; two decimals under 1 in. */
export function formatRain(mm: number): string {
  if (imperial()) {
    const inches = mm / MM_PER_INCH;
    return `${formatNumber(inches, inches < 1 ? 2 : 1)}${NBSP}in`;
  }
  const fraction = mm > 0 && mm < 1;
  return `${formatNumber(fraction ? mm : Math.round(mm), fraction ? 1 : 0)}${NBSP}mm`;
}

/** Wind speed in whole km/h or mph. */
export function formatWind(kmh: number): string {
  return imperial()
    ? `${formatNumber(Math.round(kmh / KM_PER_MILE), 0)}${NBSP}mph`
    : `${formatNumber(Math.round(kmh), 0)}${NBSP}km/h`;
}

/**
 * Whether a units choice is shown: only once a region writes feet, since
 * metric needs no choosing. Guard: `units.test.ts` ("offersUnitsChoice").
 */
export function offersUnitsChoice(
  regions: readonly Region[] = REGIONS,
): boolean {
  return regions.some((region) => region.units === "imperial");
}

/**
 * The units an account reads: its own choice (`uiPreferences.units`), else
 * its home region's. Guard: `units.test.ts` ("unitsOf").
 */
export function unitsOf(
  uiPreferences: unknown,
  regions: readonly Region[] = REGIONS,
): Units {
  const chosen =
    typeof uiPreferences === "object" && uiPreferences !== null
      ? (uiPreferences as { units?: unknown }).units
      : undefined;
  return isUnits(chosen) ? chosen : accountRegion(uiPreferences, regions).units;
}

/** A stored or sent value that names a units choice. */
export function isUnits(value: unknown): value is Units {
  return value === "metric" || value === "imperial";
}
