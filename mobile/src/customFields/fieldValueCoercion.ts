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
 * "remove the key" and absent means "leave it alone" — so skipping an empty
 * value made clearing a field impossible: the user deleted the text, saved,
 * and the old value was still there with no error and often no toast, because
 * nothing had changed. The seven canyon axes never had this bug; they write an
 * explicit null for a cleared axis, and this is that rule applied to every
 * other field. Only definitions the form actually RENDERED may be passed in,
 * or this clears fields nobody was asked about.
 *
 * A YES/NO IS THREE STATES, and unset is a null like any other field's. No is
 * an explicit `false`. It used to write `false` for every toggle the form
 * showed, touched or not (UX-004: "an unchecked box IS an explicit No"), which
 * on a trip left a No nobody gave behind on every trip the attribute was ever
 * shown on — counted as answered by the stats, and kept after the tag that
 * asked for it came off. Logjam Web still draws a checkbox, and still writes
 * that false, until its rework.
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
 * Comparing `JSON.stringify` output reported a change on nearly every save:
 * Postgres `jsonb` hands keys back in its own order (shortest first), and a form
 * builds them in the definitions' order. So every trip edit re-sent every
 * attribute, and a notes-only edit could overwrite an attribute changed on
 * another device since the last sync.
 */
export function sameFieldValues(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => key in b && JSON.stringify(a[key]) === JSON.stringify(b[key]))
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

/** One row of a detail screen's attribute table. */
export type AttributeRow = [key: string, label: string, value: unknown];

/**
 * Every stored value as a row of a detail screen's attribute table: the defined
 * ones first, in the definitions' order and under their bare label, then any
 * value whose definition is gone (deleted elsewhere, or not loaded) under its
 * un-slugged key.
 *
 * ONE BUILDER FOR TRIPS AND PLACES, so the two tables cannot disagree about
 * what they list. The bare label rather than `customFieldDisplayLabel`: the
 * "(1-5)" that helps someone typing into a box is noise beside a value already
 * typed. A key defined twice — a shared place labels with the viewer's own
 * definitions AND the owner's snapshot — lists once, under the first.
 */
export function attributeRows(
  // Key and label only: a shared place's owner snapshot is typed loosely.
  defs: readonly { key: string; label: string }[],
  values: Record<string, unknown>,
): AttributeRow[] {
  const labels = new Map<string, string>();
  for (const def of defs) {
    if (!labels.has(def.key)) labels.set(def.key, def.label);
  }
  const defined = [...labels]
    .filter(([key]) => values[key] !== undefined)
    .map(([key, label]): AttributeRow => [key, label, values[key]]);
  const orphaned = Object.entries(values)
    .filter(([key]) => !labels.has(key))
    .map(([key, value]): AttributeRow => [key, humanizeFieldKey(key), value]);
  return [...defined, ...orphaned];
}

/** Keys are slugs of the original label (`makeCustomFieldKey`), so un-slugging
 *  beats showing `water_level` raw. */
export function humanizeFieldKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * The widest span that still reads as a rail rather than a ruler.
 *
 * A bounded integer is drawn as a row of stops instead of a number box, which
 * is how the canyon grades have always been drawn — they just used to be seven
 * hand-written controls in `PlaceEditSheet` with their keys spelled out. They
 * are ordinary bounded integers, so the rail is now a property of the TYPE and
 * every field that shares that shape gets it: a user's own "Difficulty, 1-5"
 * is drawn exactly like the V grade, without knowing anything about canyons.
 *
 * Above this the stops stop being tappable and a keyboard is faster. `hours`
 * and `num_abseils` are unbounded and were never rail candidates.
 */
const MAX_RAIL_STOPS = 12;

/** The stops a bounded integer draws, or null when it is not rail-shaped.
 *  Derived from the definition's own bounds, which is the only place they are
 *  declared — a rail that restated 1-7 would drift from the field it draws. */
export function railStops(def: TripLogCustomFieldDef): number[] | null {
  if (def.type !== "integer") return null;
  if (def.min == null || def.max == null) return null;
  const span = def.max - def.min;
  if (span < 1 || span + 1 > MAX_RAIL_STOPS) return null;
  const stops: number[] = [];
  for (let stop = def.min; stop <= def.max; stop += 1) stops.push(stop);
  return stops;
}

