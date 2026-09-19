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
 *  missing value as "" (or "false" for a toggle, which has no empty state). */
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
 * "remove the key" and absent means "leave it alone" — so skipping an empty
 * value made clearing a field impossible: the user deleted the text, saved,
 * and the old value was still there with no error and often no toast, because
 * nothing had changed. The seven canyon axes never had this bug; they write an
 * explicit null for a cleared axis, and this is that rule applied to every
 * other field. Only definitions the form actually RENDERED may be passed in,
 * or this clears fields nobody was asked about.
 *
 * A BOOLEAN ALWAYS WRITES ITS VALUE, false included. Skipping false left the
 * phone unable to answer "no" at all, and it disagreed with the web, which
 * stores an explicit false (an unchecked box and an explicit No are one state
 * — UX-004). The filter reads a stored value, so "Is a cave? · No" on a detail
 * page was invisible to a filter for No.
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
    if (def.type === "boolean") {
      result[def.key] = coerceFieldValue(raw ?? "false", def.type);
      continue;
    }
    result[def.key] =
      raw == null || raw.trim() === "" ? null : coerceFieldValue(raw, def.type);
  }
  return result;
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
