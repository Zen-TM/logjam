// Pure helpers for the GeoPdfDialog extent inputs.
//
// The four extent fields are free-text numeric inputs whose displayed value
// depends on the coord mode: WGS84 degrees in "latlon", metres of the grid of
// the ground the extent covers in "enNorthing" (MGA2020 in NSW, NZTM2000 in
// New Zealand, UTM elsewhere: `sheetGrid`). A typed value must be parsed in
// the active coord mode (rather than fed straight to degree-based helpers),
// and inverted or non-numeric values are surfaced inline with validation
// errors:
//   - parseExtentField: raw string → WGS84 degrees honouring the coord mode
//     (inverse grid projection, paired with the same corner the display uses);
//   - extentFieldErrors: per-field inline messages (number required, lat/lng
//     range, North > South, East > West — sign-correct comparisons only, no
//     hemisphere assumptions).

import {
  boxCentre,
  GRID_NAMES,
  gridNamedAt,
  t,
  type ExtentState,
} from "@logjam/shared";
import { sheetGrid } from "../../geoPdf/sheetGrid";

export type ExtentFieldKey = "n" | "s" | "e" | "w";
export type ExtentFieldValues = Record<ExtentFieldKey, string>;
export type ExtentFieldErrors = Record<ExtentFieldKey, string | null>;
/** The edges and how they are typed: a GeoPDF's extent, or a free box. */
type Edges = Pick<
  ExtentState,
  "north" | "south" | "east" | "west" | "coordMode"
>;

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
 * the one zone at the extent's centre, as the printed grid is.
 */
export function parseExtentField(
  field: ExtentFieldKey,
  raw: string,
  state: Edges,
): number | null {
  const v = rawToNumber(raw);
  if (v === null) return null;
  if (state.coordMode === "latlon") return v;

  const grid = sheetGrid(state);
  switch (field) {
    case "n":
      return grid.fromGrid(grid.toGrid(state.north, state.west).easting, v).lat;
    case "s":
      return grid.fromGrid(grid.toGrid(state.south, state.east).easting, v).lat;
    case "e":
      return grid.fromGrid(v, grid.toGrid(state.north, state.east).northing)
        .lon;
    case "w":
      return grid.fromGrid(v, grid.toGrid(state.south, state.west).northing)
        .lon;
  }
}

/**
 * One field's text for the edges as they stand: degrees in "latlon", grid
 * metres in "enNorthing", at the corner `parseExtentField` pairs it with, so
 * parsing the text gives the edge back (geoPdfExtentFields.test.ts).
 */
export function extentFieldText(field: ExtentFieldKey, state: Edges): string {
  const [lat, lon] = {
    n: [state.north, state.west],
    s: [state.south, state.east],
    e: [state.north, state.east],
    w: [state.south, state.west],
  }[field];
  const latitude = field === "n" || field === "s";
  if (state.coordMode === "latlon") return (latitude ? lat : lon).toFixed(6);
  const en = sheetGrid(state).toGrid(lat, lon);
  return (latitude ? en.northing : en.easting).toFixed(1);
}

/** The grid the copy names for these edges: the one the Layers popover names for the same ground. */
const gridOf = (
  state: Pick<ExtentState, "north" | "south" | "east" | "west">,
) => gridNamedAt(boxCentre(state));

/** What the E/N chip says it is: the grid printed on the maps of the ground the extent covers. */
export function coordTooltip(
  state: Pick<ExtentState, "north" | "south" | "east" | "west">,
): string {
  switch (gridOf(state)) {
    case "mga2020":
      return t`Lat/Lon is what a GPS shows you. E/N is the MGA2020 grid, the one printed on NSW topo maps.`;
    case "nztm2000":
      return t`Lat/Lon is what a GPS shows you. E/N is the NZTM2000 grid, the one printed on New Zealand topo maps.`;
    case "utm":
      return t`Lat/Lon is what a GPS shows you. E/N is the UTM grid, the one printed on topo maps in much of the world.`;
  }
}

const LAT_FIELDS: ExtentFieldKey[] = ["n", "s"];

function rangeError(
  field: ExtentFieldKey,
  deg: number,
  grid: string | null,
): string | null {
  if (LAT_FIELDS.includes(field)) {
    if (deg < -90 || deg > 90) {
      return grid === null
        ? "Must be between -90 and 90"
        : t`Not a valid ${grid} northing`;
    }
  } else if (deg < -180 || deg > 180) {
    return grid === null
      ? "Must be between -180 and 180"
      : t`Not a valid ${grid} easting`;
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
  state: Edges,
): ExtentFieldErrors {
  const grid = state.coordMode === "latlon" ? null : GRID_NAMES[gridOf(state)];
  const errors: ExtentFieldErrors = { n: null, s: null, e: null, w: null };
  const degrees: Record<ExtentFieldKey, number | null> = {
    n: null,
    s: null,
    e: null,
    w: null,
  };

  for (const field of ["n", "s", "e", "w"] as ExtentFieldKey[]) {
    const deg = parseExtentField(field, values[field], state);
    if (deg === null) {
      errors[field] = "Enter a number";
      continue;
    }
    errors[field] = rangeError(field, deg, grid);
    if (errors[field] === null) degrees[field] = deg;
  }

  // Sign-correct orientation checks (work in both hemispheres; grid northings/
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
  return (
    errors.n !== null ||
    errors.s !== null ||
    errors.e !== null ||
    errors.w !== null
  );
}

/** Inline error for the scale denominator field ("1 : N"). */
export function scaleFieldError(raw: string): string | null {
  const v = rawToNumber(raw);
  if (v === null) return "Enter a number";
  if (v < 1) return "Must be at least 1";
  return null;
}
