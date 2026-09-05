// Single source of truth for place coordinate + numeric-field ranges, shared
// by the API (POST/PATCH /places), the CSV bulk-import path
// (api/src/routes/placesBulk.ts), and the frontend dialogs so every surface
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

export type NumericConstraint = {
  /** Inclusive lower bound, or null for none. */
  min: number | null;
  /** Inclusive upper bound, or null for none. */
  max: number | null;
  /** When true, the value must be a whole number. */
  integer: boolean;
  /** Human label used to build API-facing error messages. */
  label: string;
};

/**
 * A field definition's bounds, as a constraint — or null when it has none.
 *
 * This REPLACES the hardcoded PLACE_NUMERIC_CONSTRAINTS table. The seven grade
 * columns became field values, and their bounds became the `min`/`max` of the
 * system definitions that describe them, so a second table restating those
 * numbers would be two lists that must agree with no test to say when they
 * stop agreeing. The bounds are now enforced from exactly where they are
 * declared, for user fields and system fields alike, which is also what makes a
 * user-defined bounded field validate at all — it never did before.
 */
export function constraintFromDef(def: {
  label: string;
  type: string;
  min?: number | null;
  max?: number | null;
}): NumericConstraint | null {
  if (def.type !== "integer" && def.type !== "float") return null;
  const min = def.min ?? null;
  const max = def.max ?? null;
  if (min === null && max === null) {
    // Still constrained: an integer field rejects 2.5 whether or not it is
    // bounded. Only an unbounded FLOAT has nothing left to check.
    if (def.type !== "integer") return null;
  }
  return { min, max, integer: def.type === "integer", label: def.label };
}

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
  if (min !== null && value < min) {
    if (min === 0) return `${label} cannot be negative`;
    return max === null
      ? `${label} must be at least ${min}`
      : `${label} must be between ${min} and ${max}`;
  }
  if (max !== null && value > max) {
    return min === null
      ? `${label} must be at most ${max}`
      : `${label} must be between ${min} and ${max}`;
  }
  return null;
}

/**
 * Validate a place's `fieldValues` against the definitions in force for its
 * type. Returns the first user-facing error, or null.
 *
 * Values whose key has no definition are LEFT ALONE, not rejected: a def can be
 * deleted or rescoped while values are already stored, and the trip-log union
 * rule (§2.7) keeps showing a value whose def no longer applies rather than
 * destroying it. Rejecting here would make that impossible to save.
 */
export function validateFieldValues(
  values: Record<string, unknown>,
  defs: { key: string; label: string; type: string; min?: number | null; max?: number | null }[],
): string | null {
  const byKey = new Map(defs.map((def) => [def.key, def]));
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;
    const def = byKey.get(key);
    if (!def) continue;
    if (def.type === "integer" || def.type === "float") {
      if (typeof value !== "number") return `${def.label} must be a number`;
      const constraint = constraintFromDef(def);
      const error = constraint && numericConstraintError(value, constraint);
      if (error) return error;
    } else if (def.type === "boolean") {
      if (typeof value !== "boolean") return `${def.label} must be true or false`;
    } else if (typeof value !== "string") {
      return `${def.label} must be text`;
    }
  }
  return null;
}

/** The KEYS whose value is out of range — the per-field answer
 *  `validateFieldValues` deliberately does not give (it stops at the first
 *  error, because an API rejection is one message). See invalidPlaceFields. */
export function invalidFieldValueKeys(
  values: Record<string, unknown>,
  defs: { key: string; label: string; type: string; min?: number | null; max?: number | null }[],
): string[] {
  const byKey = new Map(defs.map((def) => [def.key, def]));
  const invalid: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;
    const def = byKey.get(key);
    if (!def) continue;
    if (validateFieldValues({ [key]: value }, [def])) invalid.push(key);
  }
  return invalid;
}

export type PlaceFieldPayload = {
  latitude?: unknown;
  longitude?: unknown;
  /** Type-specific values. Validated against the type's DEFINITIONS, which the
   *  caller supplies — this module has no way to load them. */
  fieldValues?: unknown;
};

/**
 * Validate the coordinate + numeric fields of a place create/update payload.
 * Returns the first user-facing error string, or null when everything is valid.
 *
 * - `requireCoords: true` (create) demands latitude AND longitude be present
 *   and in range.
 * - `requireCoords: false` (patch) validates coordinates only when supplied.
 *
 * `fieldValues` is validated only when `opts.defs` is given. The definitions
 * cannot be reached from here — they are rows — so a caller that has them
 * passes them, and a caller that does not gets coordinate validation alone
 * rather than a silent pass on values it never checked.
 */
export function validatePlacePayload(
  payload: PlaceFieldPayload,
  opts: {
    requireCoords: boolean;
    defs?: { key: string; label: string; type: string; min?: number | null; max?: number | null }[];
  },
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

  if (opts.defs && payload.fieldValues !== undefined) {
    if (
      payload.fieldValues === null ||
      typeof payload.fieldValues !== "object" ||
      Array.isArray(payload.fieldValues)
    ) {
      return "Field values must be an object";
    }
    const error = validateFieldValues(
      payload.fieldValues as Record<string, unknown>,
      opts.defs,
    );
    if (error) return error;
  }

  return null;
}

/**
 * WHICH fields of a place payload are out of range — the per-field answer
 * `validatePlacePayload` deliberately does not give (it stops at the first
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
export function invalidPlaceFields(
  fields: Record<string, unknown>,
  defs: { key: string; label: string; type: string; min?: number | null; max?: number | null }[] = [],
): string[] {
  const invalid: string[] = [];
  if ("latitude" in fields && !isValidLatitude(fields.latitude)) invalid.push("latitude");
  if ("longitude" in fields && !isValidLongitude(fields.longitude)) {
    invalid.push("longitude");
  }
  // An out-of-range VALUE names `fieldValues`, not the key inside it: the whole
  // blob is one dirty field on the wire, so that is the granularity the client
  // can act on when it decides which parked fields to resend.
  const values = fields.fieldValues;
  if (values != null && typeof values === "object" && !Array.isArray(values)) {
    if (invalidFieldValueKeys(values as Record<string, unknown>, defs).length > 0) {
      invalid.push("fieldValues");
    }
  }
  return invalid;
}
