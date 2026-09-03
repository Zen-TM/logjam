// Single source of truth for canyon coordinate + numeric-field ranges, shared
// by the API (POST/PATCH /canyons), the CSV bulk-import path
// (api/src/routes/canyonsBulk.ts), and the frontend dialogs so every surface
// rejects the same out-of-range values.

export const LATITUDE_RANGE = { min: -90, max: 90 } as const;
export const LONGITUDE_RANGE = { min: -180, max: 180 } as const;

export function isValidLatitude(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= LATITUDE_RANGE.min &&
    value <= LATITUDE_RANGE.max
  );
}

export function isValidLongitude(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= LONGITUDE_RANGE.min &&
    value <= LONGITUDE_RANGE.max
  );
}

/** Numeric-field names on a canyon that carry a validated range. */
export type CanyonNumericFieldName =
  | "vGrade"
  | "aGrade"
  | "commitment"
  | "quality"
  | "numAbseils"
  | "longestAbseil"
  | "hours";

export type NumericConstraint = {
  /** Inclusive lower bound. */
  min: number;
  /** Inclusive upper bound, or null for no upper bound. */
  max: number | null;
  /** When true, the value must be a whole number. */
  integer: boolean;
  /** Human label used to build API-facing error messages. */
  label: string;
};

// Grades/quality/commitment carry known scales.
// numAbseils/longestAbseil/hours have no natural upper bound — only reject
// negatives (a count/length/duration can't be below zero).
export const CANYON_NUMERIC_CONSTRAINTS: Record<
  CanyonNumericFieldName,
  NumericConstraint
> = {
  vGrade: { min: 1, max: 7, integer: true, label: "V grade" },
  aGrade: { min: 1, max: 7, integer: true, label: "A grade" },
  commitment: { min: 1, max: 6, integer: true, label: "Commitment" },
  quality: { min: 1, max: 5, integer: false, label: "Quality" },
  numAbseils: { min: 0, max: null, integer: true, label: "Pitches" },
  longestAbseil: { min: 0, max: null, integer: false, label: "Longest pitch" },
  hours: { min: 0, max: null, integer: false, label: "Hours" },
};

/**
 * Validate a single numeric value against a constraint. Returns a user-facing
 * error string (prefixed with the field label) or null when valid. Pure.
 */
export function numericConstraintError(
  value: number,
  constraint: NumericConstraint,
): string | null {
  const { min, max, integer, label } = constraint;
  if (!Number.isFinite(value)) return `${label} must be a number`;
  if (integer && !Number.isInteger(value)) {
    return `${label} must be a whole number`;
  }
  if (value < min) {
    if (min === 0) return `${label} cannot be negative`;
    return max == null
      ? `${label} must be at least ${min}`
      : `${label} must be between ${min} and ${max}`;
  }
  if (max != null && value > max) {
    return `${label} must be between ${min} and ${max}`;
  }
  return null;
}

export type CanyonFieldPayload = {
  latitude?: unknown;
  longitude?: unknown;
  vGrade?: unknown;
  aGrade?: unknown;
  commitment?: unknown;
  quality?: unknown;
  numAbseils?: unknown;
  longestAbseil?: unknown;
  hours?: unknown;
};

/**
 * Validate the coordinate + numeric fields of a canyon create/update payload.
 * Returns the first user-facing error string, or null when everything is valid.
 *
 * - `requireCoords: true` (create) demands latitude AND longitude be present
 *   and in range.
 * - `requireCoords: false` (patch) validates coordinates only when supplied.
 * Numeric fields are validated whenever present and non-null.
 */
export function validateCanyonPayload(
  payload: CanyonFieldPayload,
  opts: { requireCoords: boolean },
): string | null {
  const { latitude, longitude } = payload;

  if (opts.requireCoords || latitude !== undefined) {
    if (!isValidLatitude(latitude)) {
      return `Latitude must be a number between ${LATITUDE_RANGE.min} and ${LATITUDE_RANGE.max}`;
    }
  }
  if (opts.requireCoords || longitude !== undefined) {
    if (!isValidLongitude(longitude)) {
      return `Longitude must be a number between ${LONGITUDE_RANGE.min} and ${LONGITUDE_RANGE.max}`;
    }
  }

  for (const field of Object.keys(
    CANYON_NUMERIC_CONSTRAINTS,
  ) as CanyonNumericFieldName[]) {
    const value = payload[field];
    if (value === undefined || value === null) continue;
    const constraint = CANYON_NUMERIC_CONSTRAINTS[field];
    if (typeof value !== "number") return `${constraint.label} must be a number`;
    const error = numericConstraintError(value, constraint);
    if (error) return error;
  }

  return null;
}

/**
 * WHICH fields of a canyon payload are out of range — the per-field answer
 * `validateCanyonPayload` deliberately does not give (it stops at the first
 * error, because an API rejection is one message).
 *
 * The client needs the field NAMES rather than a sentence: a parked op carries
 * several dirty fields and only one of them is usually the problem, so knowing
 * which lets the good ones be sent on instead of the whole edit sitting on the
 * sync-issues screen. Derived from the SAME constraint table as the sentence,
 * so the two can never disagree about what is valid.
 *
 * Only range/type violations are visible here. A rejection for any other reason
 * (an unknown field, a server-side rule) yields an empty list, which callers
 * must read as "can't tell", not as "everything is fine".
 */
export function invalidCanyonFields(fields: Record<string, unknown>): string[] {
  const invalid: string[] = [];
  if ("latitude" in fields && !isValidLatitude(fields.latitude)) invalid.push("latitude");
  if ("longitude" in fields && !isValidLongitude(fields.longitude)) {
    invalid.push("longitude");
  }
  for (const field of Object.keys(CANYON_NUMERIC_CONSTRAINTS) as CanyonNumericFieldName[]) {
    if (!(field in fields)) continue;
    const value = fields[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number") {
      invalid.push(field);
      continue;
    }
    if (numericConstraintError(value, CANYON_NUMERIC_CONSTRAINTS[field])) {
      invalid.push(field);
    }
  }
  return invalid;
}
