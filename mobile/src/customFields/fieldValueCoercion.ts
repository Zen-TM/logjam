// The pure half of the custom-field VALUE editor. Named for what it does
// rather than `customFieldValues.ts`, which would differ from its sibling
// component only by case — and a case-only pair is a file collision on a
// case-insensitive filesystem, i.e. on any Mac.
//
// The pure half of the custom-field VALUE editor: stored values in, stored
// values out, no React and no react-native — which is what makes it testable
// (`fieldValueCoercion.test.ts`). The inputs that render these live beside it in
// `CustomFieldValues.tsx`; splitting them is the repo's standing rule for logic
// tangled with a native component.
import { coerceFieldValue, type TripLogCustomFieldDef } from "@logjam/shared";

/** Seed the editing state from stored values: everything as a string, and a
 *  missing value as "" — a yes/no included, which has "—" for unset. */
export function fieldValueStrings(
  stored: Record<string, unknown> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(stored ?? {}).map(([key, value]) => [
      key,
      value == null ? "" : String(value),
    ]),
  );
}

/**
 * String form → stored value, using the shared coercion so a number typed here
 * lands as a number, not a string.
 *
 * AN EMPTIED FIELD IS `null`, NOT ABSENT, and that distinction is the whole
 * point. The place form merges this over the stored object, where `null` means
 * "remove the key" and absent means "leave it alone" — skipping an empty
 * value would make clearing a field impossible, leaving the old value intact
 * (Guard: fieldValueCoercion.test.ts). Only definitions the form actually
 * RENDERED may be passed in, or this clears fields nobody was asked about.
 *
 * A YES/NO IS THREE STATES, and unset is a null like any other field's. No is
 * an explicit `false`. Writing `false` for every toggle shown, touched or not,
 * would leave an unintended No on every trip the attribute was shown on —
 * counted as answered by stats and retained after tags change
 * (Guard: fieldValueCoercion.test.ts).
 *
 * A caller that REPLACES rather than merges (the trip form) drops the nulls
 * itself — see `withoutClearedFields`.
 */
export function coerceCustomFields(
  values: Record<string, string>,
  defs: TripLogCustomFieldDef[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const def of defs) {
    const raw = values[def.key];
    result[def.key] =
      raw == null || raw.trim() === "" ? null : coerceFieldValue(raw, def.type);
  }
  return result;
}

/**
 * Whether two stored value objects say the same thing, key ORDER ignored.
 *
 * Comparing `JSON.stringify` output would report a change on nearly every save:
 * Postgres `jsonb` hands keys back in its own order (shortest first), and a form
 * builds them in the definitions' order. Key order must be ignored so an edit
 * does not falsely overwrite unchanged attributes
 * (Guard: fieldValueCoercion.test.ts).
 */
export function sameFieldValues(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) => key in b && JSON.stringify(a[key]) === JSON.stringify(b[key]),
    )
  );
}

/** For a caller that writes the whole object rather than merging: a cleared
 *  field is simply absent, because there is nothing to clear it FROM. */
export function withoutClearedFields(
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null),
  );
}
