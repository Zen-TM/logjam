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

import { t } from "./i18n.js";
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

// Feet stored as metres are rounded to this many decimals: finer than a foot
// typed to three decimals (0.0003048 m), and coarse enough that 35 ft is
// 10.668 m, not the 10.668000000000001 the multiplication leaves.
const STORED_METRE_DECIMALS = 7;

/**
 * What the user typed in a length field, as metres. Metric is stored as typed;
 * feet are rounded to `STORED_METRE_DECIMALS`, so a metric reader of the same
 * place sees "10.668 m". Guard: `units.test.ts` ("a length field").
 */
export function lengthFromInput(value: number): number {
  if (!imperial()) return value;
  const scale = 10 ** STORED_METRE_DECIMALS;
  return Math.round(value * METRES_PER_FOOT * scale) / scale;
}

/** Metres as the length field shows them, unrounded: the form rounds. */
export function lengthToInput(metres: number): number {
  return imperial() ? metres / METRES_PER_FOOT : metres;
}

/**
 * Metres as a length field's text: the digits stored in metric, feet to one
 * decimal ("98.4"). Always the figure alone: the field's label or
 * `lengthUnitLabel()` says the unit. Guard: `units.test.ts` ("lengthInputText").
 */
export function lengthInputText(metres: number): string {
  if (!imperial()) return String(metres);
  const ft = Math.round((metres / METRES_PER_FOOT) * 10) / 10;
  return formatNumber(ft, Number.isInteger(ft) ? 0 : 1);
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

/**
 * The ground one map pixel covers, "0.5 m" or "32 ft": whole from 10 up, else
 * one decimal with a trailing ".0" dropped. The rounding is of the figure shown.
 */
export function formatGroundStep(metres: number): string {
  const value = imperial() ? metres / METRES_PER_FOOT : metres;
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${formatNumber(rounded, Number.isInteger(rounded) ? 0 : 1)} ${lengthUnitLabel()}`;
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

const inFeet = (...values: number[]) => values.map((v) => v * METRES_PER_FOOT);
const inMiles = (...values: number[]) => values.map((v) => v * METRES_PER_MILE);

// Round ground distances a scale bar can span, in metres, smallest first. Each
// list is round in its own units, so no unit's bar reads "164 ft". The screen's
// ends at 500 km or mi, where a whole state fits and the bar stops helping; the
// printed sheet's is the few steps a page of a map can hold.
const SCALE_STEPS = {
  screen: {
    metric: [
      1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000,
      50_000, 100_000, 200_000, 500_000,
    ],
    imperial: [
      ...inFeet(1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000),
      ...inMiles(0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500),
    ],
  },
  print: {
    metric: [100, 250, 500, 1_000, 2_000, 5_000, 10_000],
    imperial: [...inFeet(200, 500, 1_000, 2_000), ...inMiles(0.5, 1, 2, 5, 10)],
  },
} as const;

/** The distances a scale bar of this kind can span, in metres, smallest first. */
export function scaleBarSteps(kind: "screen" | "print"): readonly number[] {
  return SCALE_STEPS[kind][current];
}

/**
 * A scale bar's label: "500 m", "2 km", "0.5 mi", "200 ft". A whole number of
 * km or mi drops its decimal (a bar says "1 km", where a distance says
 * "1.0 km"), so this is not `formatDistance`. Metric is km from 1000 m,
 * imperial miles from half a mile. Guard: `units.test.ts` ("scale bars").
 */
export function formatScaleStep(metres: number): string {
  if (imperial()) {
    if (metres < METRES_PER_MILE / 2)
      return `${formatNumber(Math.round(metres / METRES_PER_FOOT), 0)} ft`;
    const mi = Math.round((metres / METRES_PER_MILE) * 10) / 10;
    return `${formatNumber(mi, Number.isInteger(mi) ? 0 : 1)} mi`;
  }
  const whole = Math.round(metres);
  if (whole < 1_000) return `${formatNumber(whole, 0)} m`;
  const km = whole / 1_000;
  return `${formatNumber(km, Number.isInteger(km) ? 0 : 1)} km`;
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
  const unit = imperial() ? t`sq mi` : "km²";
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
 * The units an account reads: its own choice (`uiPreferences.units`) while a
 * choice is offered, else its home region's. Where none is offered (prod's NSW
 * alone) a stored choice is not read, since nothing there could undo it; it
 * counts again once a region uses feet. Guard: `units.test.ts` ("unitsOf").
 */
export function unitsOf(
  uiPreferences: unknown,
  regions: readonly Region[] = REGIONS,
): Units {
  const chosen =
    typeof uiPreferences === "object" && uiPreferences !== null
      ? (uiPreferences as { units?: unknown }).units
      : undefined;
  return isUnits(chosen) && offersUnitsChoice(regions)
    ? chosen
    : accountRegion(uiPreferences, regions).units;
}

/**
 * Whether choosing `next` stores something: yes unless that very choice is
 * already stored. Tapping the units the home region gives, with nothing
 * stored, still stores them, so the choice survives a later change of home
 * region. Both clients decide a tap here. Guard: `units.test.ts`
 * ("choosesUnits").
 */
export function choosesUnits(stored: unknown, next: Units): boolean {
  return stored !== next;
}

/** A stored or sent value that names a units choice. */
export function isUnits(value: unknown): value is Units {
  return value === "metric" || value === "imperial";
}
