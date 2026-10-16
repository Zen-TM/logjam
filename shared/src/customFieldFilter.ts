/**
 * Custom-field filtering — the ONE answer to "does this record's value for a
 * user-defined field pass this filter", for places and for trips alike.
 *
 * Only ONE thing differs between the two entities — a place keeps its answers
 * in `fieldValues` and a trip in `customFields` — so this takes the values
 * object rather than the record, and neither client can end up with a
 * different idea of what "over 30, include unknowns" means. A shared switch
 * avoids duplicated logic and edge cases: unparsable dates like "15/01/2026"
 * must not match every range, and `includeUnknowns` must be consulted for each
 * condition rather than only at the top.
 *
 * PRIVACY: pure predicates over values the caller already holds. Nothing here
 * logs — a user-authored field label is as sensitive as a note (root AGENTS.md).
 */
import { fieldValue } from "./fieldValues.js";
import type { TripLogCustomFieldDef } from "./tripLogFields.js";

/** [start, end] inclusive ISO-date bounds (yyyy-mm-dd); either bound nullable. */
export type FieldDateRange = [string | null, string | null];

/**
 * A single active custom-field filter. Self-describing (carries its own kind)
 * so the predicate can apply it without consulting the field definitions. The
 * kind maps from the field's TripLogCustomFieldType: string→text,
 * integer/float→number, date→date, boolean→boolean.
 */
export type CustomFieldFilter =
  | { kind: "text"; value: string }
  | { kind: "number"; op: "Less than" | "More than" | "Exactly"; value: number }
  // Inclusive [min, max] range for bounded integer/float fields; rendered as a
  // double-ended slider. Full span commits as null (the inactive state).
  | { kind: "numberRange"; range: [number, number] }
  | { kind: "date"; range: FieldDateRange }
  | { kind: "boolean"; value: boolean };

/**
 * Maps a custom-field definition to the filter kind it produces, so a stored
 * filter can be validated against the current definition. Bounded
 * integer/float fields render a range slider (numberRange); unbounded ones use
 * op+value.
 */
export function customFilterKind(
  def: TripLogCustomFieldDef,
): CustomFieldFilter["kind"] {
  switch (def.type) {
    case "string":
      return "text";
    case "integer":
    case "float":
      return def.min != null && def.max != null ? "numberRange" : "number";
    case "date":
      return "date";
    case "boolean":
      return "boolean";
  }
}

/**
 * Midnight of a `yyyy-mm-dd` bound in the VIEWER's timezone, or null if it
 * isn't a usable date.
 *
 * `created_at`/`updated_at` are instants, whereas bounds represent local
 * calendar days. `Date.parse` on a date-only string is UTC by spec, which
 * misaligns local times in positive UTC offsets (e.g. Sydney AEDT/AEST); the
 * explicit `T00:00:00` form parses as local time by spec.
 */
function dayStartMs(day: string | null | undefined): number | null {
  if (day == null) return null;
  const parsed = new Date(`${day}T00:00:00`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Inclusive on both bounds. A value that cannot be placed on a calendar is an
 * unknown, not a match: returning true for an unparsable date would match every
 * range, in or out.
 */
export function passesDateRangeFilter(
  value: string | null | undefined,
  filter: FieldDateRange | null,
  includeUnknowns: boolean,
): boolean {
  if (!filter) return true;
  const [start, end] = filter;
  if (start == null && end == null) return true;
  if (value == null) return includeUnknowns;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return includeUnknowns;
  const from = dayStartMs(start);
  if (from != null && time < from) return false;
  if (end != null) {
    const endOfDay = dayStartMs(end);
    if (endOfDay != null && time > endOfDay + 24 * 60 * 60 * 1000 - 1) {
      return false;
    }
  }
  return true;
}

/**
 * Every active attribute filter, applied to one record's answers. A record
 * that never answered a filtered field is an unknown, and `includeUnknowns`
 * decides whether an unknown is kept — the choice exists because most records
 * answer most fields not at all, so without it one attribute filter empties
 * the list.
 *
 * `values` is a place's `fieldValues` or a trip's `customFields`; `fieldValue`
 * treats null as unanswered, so a cleared field reads the same as one never
 * filled in.
 */
export function passesCustomFieldFilters(
  values: unknown,
  custom: Record<string, CustomFieldFilter> | null | undefined,
  includeUnknowns: boolean,
): boolean {
  for (const [key, filter] of Object.entries(custom ?? {})) {
    const value = fieldValue(values, key);
    if (value == null) {
      if (!includeUnknowns) return false;
      continue;
    }
    switch (filter.kind) {
      case "text":
        if (!String(value).toLowerCase().includes(filter.value.toLowerCase()))
          return false;
        break;
      case "number": {
        const num = typeof value === "number" ? value : Number(value);
        if (filter.op === "Less than" && !(num < filter.value)) return false;
        if (filter.op === "More than" && !(num > filter.value)) return false;
        if (filter.op === "Exactly" && num !== filter.value) return false;
        break;
      }
      case "numberRange": {
        const num = typeof value === "number" ? value : Number(value);
        if (Number.isNaN(num)) {
          if (!includeUnknowns) return false;
          break;
        }
        if (num < filter.range[0] || num > filter.range[1]) return false;
        break;
      }
      case "boolean":
        if (Boolean(value) !== filter.value) return false;
        break;
      case "date":
        if (
          !passesDateRangeFilter(String(value), filter.range, includeUnknowns)
        )
          return false;
        break;
    }
  }
  return true;
}

/**
 * Drops filters that no longer correspond to a live definition (deleted field)
 * or whose stored kind no longer matches the field's type (deleted, then
 * recreated with a different type). Returns the same reference when nothing
 * changes so callers can rely on identity stability.
 */
export function reconcileCustomFieldFilters(
  custom: Record<string, CustomFieldFilter> | null | undefined,
  defs: readonly TripLogCustomFieldDef[],
): Record<string, CustomFieldFilter> {
  const current = custom ?? {};
  const next: Record<string, CustomFieldFilter> = {};
  for (const [key, filter] of Object.entries(current)) {
    const def = defs.find((d) => d.key === key);
    if (def && customFilterKind(def) === filter.kind) {
      next[key] = filter;
    }
  }
  return Object.keys(next).length === Object.keys(current).length
    ? current
    : next;
}
