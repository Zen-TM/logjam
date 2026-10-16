// Reading and writing `Place.fieldValues`.
//
// Grade and custom field values are stored as JSON keys, which means type
// checking is application-level. Every site reaching into this untyped blob
// must handle the three cases that matter consistently: a missing key, a
// stored `null`, and a value of the wrong type. This module is the one
// answer, so that disagreement cannot happen.
//
// The rules, all three deliberate:
//  * MISSING AND NULL ARE THE SAME THING — "no value". `setFieldValue(k, null)`
//    deletes the key rather than storing a null, because a stored null renders
//    as an empty field and satisfies a "has a value" filter.
//  * A WRONG-TYPED VALUE READS AS ABSENT rather than throwing. These blobs
//    outlive the definitions that describe them: a def can be retyped from
//    integer to string while values are already stored, and a renderer that
//    throws on the mismatch takes the whole screen down for one stale row.
//    Writes are validated (assertValidDef / the push allowlist); reads forgive.
//  * KEYS STARTING WITH `_` ARE INTERNAL (`_sources` today) and never
//    appear as a user field. `makeCustomFieldKey` cannot produce one, so this
//    is structural rather than a convention — see placeTypes.ts.

import { isInternalFieldValueKey } from "./placeTypes.js";

export type FieldValues = Record<string, unknown>;

/** Coerce whatever the database handed back into a plain record. */
export function asFieldValues(value: unknown): FieldValues {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as FieldValues)
    : {};
}

export function fieldValue(values: unknown, key: string): unknown {
  const value = asFieldValues(values)[key];
  return value === null ? undefined : value;
}

/** A finite number, or undefined. NaN and Infinity are not values. */
export function numericFieldValue(
  values: unknown,
  key: string,
): number | undefined {
  const value = fieldValue(values, key);
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Return number | null, for call sites that speak `number | null` (Prisma
 *  selects, API responses, exports). */
export function numericFieldValueOrNull(
  values: unknown,
  key: string,
): number | null {
  return numericFieldValue(values, key) ?? null;
}

export function stringFieldValue(
  values: unknown,
  key: string,
): string | undefined {
  const value = fieldValue(values, key);
  return typeof value === "string" ? value : undefined;
}

export function booleanFieldValue(
  values: unknown,
  key: string,
): boolean | undefined {
  const value = fieldValue(values, key);
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Apply a patch. A key set to null or undefined is REMOVED — see the
 * missing-and-null rule above.
 */
export function setFieldValues(
  values: unknown,
  patch: Record<string, unknown>,
): FieldValues {
  const next: FieldValues = { ...asFieldValues(values) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** The user-visible keys — internal `_`-prefixed entries excluded. */
export function userFieldKeys(values: unknown): string[] {
  return Object.keys(asFieldValues(values)).filter(
    (key) => !isInternalFieldValueKey(key),
  );
}

/** Only the user-visible entries, for export and display. */
export function userFieldValues(values: unknown): FieldValues {
  const source = asFieldValues(values);
  const out: FieldValues = {};
  for (const key of userFieldKeys(source)) out[key] = source[key];
  return out;
}

/**
 * A value carried on a place that the OWNER has no definition for — because it
 * arrived on a copy of someone else's place, or was stranded when the place's
 * type changed. Self-describing, so it can be rendered without the sender's
 * definitions and adopted into the owner's own type later.
 *
 * The same shape serves as `fieldDefsSnapshot` on a shared delta row (minus
 * `value`, which the row itself carries): one shape, two uses, which is why
 * this is not a third field mechanism.
 *
 * Written ONLY by copy and by a place-type change — never by a user edit, and
 * never present on a delta row with syncRole "shared". Guards:
 * `api/src/routes/placeFields.unit.test.ts`, `api/src/lib/placeVisibility.unit.test.ts`.
 */
export type ForeignFieldValue = {
  key: string;
  label: string;
  type: string;
  min?: number | null;
  max?: number | null;
  value: unknown;
};
