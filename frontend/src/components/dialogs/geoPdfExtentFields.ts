// Pure helpers for the GeoPdfDialog extent inputs (GEOPDF-1).
//
// The four extent fields are free-text numeric inputs whose displayed value
// depends on the coord mode: WGS84 degrees in "latlon", MGA2020 metres in
// "enNorthing". Previously a typed value was parseFloat'd and fed straight to
// the degree-based apply*Change helpers (garbage in E/N mode), and an
// inverted or non-numeric value was silently discarded on blur while the
// input kept showing it. These helpers give the dialog:
//   - parseExtentField: raw string → WGS84 degrees honouring the coord mode
//     (inverse MGA projection, paired with the same corner the display uses);
//   - extentFieldErrors: per-field inline messages (number required, lat/lng
//     range, North > South, East > West — sign-correct comparisons only, no
//     hemisphere assumptions).

import {
  toEastingNorthing,
  fromEastingNorthing,
  type ExtentState,
} from "@logjam/shared";

export type ExtentFieldKey = "n" | "s" | "e" | "w";
export type ExtentFieldValues = Record<ExtentFieldKey, string>;
export type ExtentFieldErrors = Record<ExtentFieldKey, string | null>;

function rawToNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const v = Number(trimmed);
  return Number.isFinite(v) ? v : null;
}

/**
 * Convert one field's raw string into WGS84 degrees per the coord mode.
 * Returns null when the value is not a finite number.
 *
 * E/N mode inverts exactly the projection the display uses: the dialog shows
 * N as the northing of the (north, west) corner, S of (south, east), E as the
 * easting of (north, east), W of (south, west) — so the typed metre value is
 * paired with the current corner's other coordinate and inverse-projected in
 * the same MGA zone.
 */
export function parseExtentField(
  field: ExtentFieldKey,
  raw: string,
  state: ExtentState,
): number | null {
  const v = rawToNumber(raw);
  if (v === null) return null;
  if (state.coordMode === "latlon") return v;

  switch (field) {
    case "n": {
      const base = toEastingNorthing(state.north, state.west);
      return fromEastingNorthing(base.easting, v, base.zone).lat;
    }
    case "s": {
      const base = toEastingNorthing(state.south, state.east);
      return fromEastingNorthing(base.easting, v, base.zone).lat;
    }
    case "e": {
      const base = toEastingNorthing(state.north, state.east);
      return fromEastingNorthing(v, base.northing, base.zone).lon;
    }
    case "w": {
      const base = toEastingNorthing(state.south, state.west);
      return fromEastingNorthing(v, base.northing, base.zone).lon;
    }
  }
}

const LAT_FIELDS: ExtentFieldKey[] = ["n", "s"];

function rangeError(field: ExtentFieldKey, deg: number, latlon: boolean): string | null {
  if (LAT_FIELDS.includes(field)) {
    if (deg < -90 || deg > 90) {
      return latlon ? "Must be between -90 and 90" : "Not a valid MGA northing";
    }
  } else if (deg < -180 || deg > 180) {
    return latlon ? "Must be between -180 and 180" : "Not a valid MGA easting";
  }
  return null;
}

/**
 * Validate all four extent fields together. Returns a message per field, or
 * null when that field is fine. Cross-field problems surface once, on the
 * North / East field respectively.
 */
export function extentFieldErrors(
  values: ExtentFieldValues,
  state: ExtentState,
): ExtentFieldErrors {
  const latlon = state.coordMode === "latlon";
  const errors: ExtentFieldErrors = { n: null, s: null, e: null, w: null };
  const degrees: Record<ExtentFieldKey, number | null> = { n: null, s: null, e: null, w: null };

  for (const field of ["n", "s", "e", "w"] as ExtentFieldKey[]) {
    const deg = parseExtentField(field, values[field], state);
    if (deg === null) {
      errors[field] = "Enter a number";
      continue;
    }
    errors[field] = rangeError(field, deg, latlon);
    if (errors[field] === null) degrees[field] = deg;
  }

  // Sign-correct orientation checks (work in both hemispheres; MGA northings/
  // eastings compare the same way after conversion to degrees).
  if (degrees.n !== null && degrees.s !== null && degrees.n <= degrees.s) {
    errors.n = "Must be north of the South value";
  }
  if (degrees.e !== null && degrees.w !== null && degrees.e <= degrees.w) {
    errors.e = "Must be east of the West value";
  }

  return errors;
}

export function hasExtentFieldError(errors: ExtentFieldErrors): boolean {
  return errors.n !== null || errors.s !== null || errors.e !== null || errors.w !== null;
}

/** Inline error for the scale denominator field ("1 : N"). */
export function scaleFieldError(raw: string): string | null {
  const v = rawToNumber(raw);
  if (v === null) return "Enter a number";
  if (v < 1) return "Must be at least 1";
  return null;
}
