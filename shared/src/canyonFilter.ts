// Canyon filtering — the single source of the "which canyons match" decision,
// shared by the web Canyons panel and the mobile Canyons screen.
//
// Moved here from frontend/src/canyonUtils.ts when mobile needed the same
// rules: a forked predicate means the two clients disagree about what "V3–5,
// include unknowns" means, and the disagreement shows up as canyons that exist
// on one device and not the other. `canyonUtils` re-exports these under their
// original names, so web callers are unchanged.
//
// PRIVACY: pure predicates over values the caller already holds. Nothing here
// logs, and no function takes or returns a coordinate.
import type { TripLogCustomFieldDef } from "./tripLogFields.js";

/** [start, end] inclusive ISO-date bounds (yyyy-mm-dd); either bound nullable. */
export type CanyonDateRange = [string | null, string | null];

/**
 * A single active custom-field filter. Self-describing (carries its own kind)
 * so the predicate can apply it without consulting the field definitions. The
 * kind maps from the field's TripLogCustomFieldType: string→text,
 * integer/float→number, date→date, boolean→boolean.
 */
export type CanyonCustomFieldFilter =
  | { kind: "text"; value: string }
  | { kind: "number"; op: "Less than" | "More than" | "Exactly"; value: number }
  // Inclusive [min, max] range for bounded integer/float fields; rendered as a
  // double-ended slider. Full span commits as null (the inactive state).
  | { kind: "numberRange"; range: [number, number] }
  | { kind: "date"; range: CanyonDateRange }
  | { kind: "boolean"; value: boolean };

export type CanyonThresholdFilter = [
  "Any" | "Less than" | "More than" | "Exactly",
  number,
];

export type CanyonFilters = {
  name: string | null;
  v_grade: number[] | null;
  a_grade: number[] | null;
  commitment: number[] | null;
  quality: number[] | null;
  pitches: CanyonThresholdFilter | null;
  longest_pitch: CanyonThresholdFilter | null;
  hours: CanyonThresholdFilter | null;
  ownership: "all" | "owned" | "shared";
  /** When true, keep only canyons the user has shared with at least one friend. */
  shared_by_me: boolean;
  /**
   * "Have I done it?" — a canyon is done once it has at least one linked trip,
   * the same rule the analytics completion ring counts (canyonsWithTrips).
   */
  completion: "any" | "done" | "not_done";
  created_at: CanyonDateRange | null;
  updated_at: CanyonDateRange | null;
  ropewiki: "any" | "linked" | "unlinked";
  /**
   * Active custom-field filters keyed by field key. Only active filters are
   * present; clearing a field deletes its key. Empty {} means none active.
   */
  custom: Record<string, CanyonCustomFieldFilter>;
  include_unknowns: boolean;
};

/**
 * The canyon shape the predicate actually reads — structural, so both the web
 * `TCanyon` and the mobile mirror row satisfy it without either importing the
 * other's type.
 *
 * `_count` is optional because on a canyon shared WITH the viewer these counts
 * are absent by design, not zero: the trip tally is the owner's private
 * trip-list cardinality and `shares` is their fan-out to other people, so the
 * API withholds both. Absent means "not yours to know" — never coalesce it to 0
 * and present that as an answer about a shared canyon. The mobile mirror
 * likewise has no `_count` column; it fills this in from locally derived
 * counts before filtering.
 */
export type CanyonFilterFields = {
  name: string;
  altNames?: string[];
  numAbseils?: number | null;
  longestAbseil?: number | null;
  vGrade?: number | null;
  aGrade?: number | null;
  commitment?: number | null;
  quality?: number | null;
  hours?: number | null;
  ropeWikiId?: number | null;
  createdAt?: string;
  updatedAt?: string;
  attributes?: { customFields?: Record<string, unknown> };
  _count?: { tripLogLinks: number; shares: number };
};

export const EMPTY_CANYON_FILTERS: CanyonFilters = {
  name: null,
  v_grade: null,
  a_grade: null,
  commitment: null,
  quality: null,
  pitches: null,
  longest_pitch: null,
  hours: null,
  ownership: "all",
  shared_by_me: false,
  completion: "any",
  created_at: null,
  updated_at: null,
  ropewiki: "any",
  custom: {},
  include_unknowns: false,
};

/**
 * The [min, max] span of each graded axis. One definition: it is simultaneously
 * the slider/pill bounds a UI renders, and the value that means "inactive"
 * (a filter set to its full span filters nothing).
 */
export const CANYON_RANGE_BOUNDS = {
  v_grade: [1, 7],
  a_grade: [1, 7],
  commitment: [1, 6],
  quality: [1, 5],
} as const satisfies Record<string, readonly [number, number]>;

export type CanyonRangeKey = keyof typeof CANYON_RANGE_BOUNDS;

export const CANYON_THRESHOLD_KEYS = ["pitches", "longest_pitch", "hours"] as const;
const DATE_FILTER_KEYS = ["created_at", "updated_at"] as const;

const RANGE_KEYS = Object.keys(CANYON_RANGE_BOUNDS) as CanyonRangeKey[];

/**
 * True when a single filter field is set to anything other than its inactive
 * default. Single source of truth for the count and the "any active" test.
 */
function isFilterActive(filters: CanyonFilters, key: keyof CanyonFilters): boolean {
  if (key === "name") return !!filters.name && filters.name.trim() !== "";
  if (key === "ownership") return filters.ownership !== "all";
  if (key === "shared_by_me") return filters.shared_by_me;
  if (key === "completion") return filters.completion !== "any";
  if (key === "ropewiki") return filters.ropewiki !== "any";
  if (key === "include_unknowns") return false; // a modifier, not a filter
  if ((RANGE_KEYS as string[]).includes(key)) {
    const [min, max] = CANYON_RANGE_BOUNDS[key as CanyonRangeKey];
    const value = filters[key] as number[] | null;
    return !!value && (value[0] !== min || value[1] !== max);
  }
  if ((CANYON_THRESHOLD_KEYS as readonly string[]).includes(key)) {
    const value = filters[key] as CanyonThresholdFilter | null;
    return !!value && value[0] !== "Any";
  }
  if ((DATE_FILTER_KEYS as readonly string[]).includes(key)) {
    const value = filters[key] as CanyonDateRange | null;
    return !!value && (value[0] != null || value[1] != null);
  }
  return false;
}

// Everything a badge counts: the filters that hide canyons (excluding `name`,
// which lives in its own search box, and include_unknowns).
const COUNTED_FILTER_KEYS: (keyof CanyonFilters)[] = [
  ...RANGE_KEYS,
  ...CANYON_THRESHOLD_KEYS,
  ...DATE_FILTER_KEYS,
  "ownership",
  "shared_by_me",
  "completion",
  "ropewiki",
];

/**
 * Midnight of a `yyyy-mm-dd` bound in the VIEWER's timezone, or null if it
 * isn't a usable date.
 *
 * `created_at`/`updated_at` are real instants, and the bounds were parsed as
 * UTC midnight — so in Sydney (UTC+10/+11) everything added between local
 * midnight and 11:00 filed under the previous day. A canyon added
 * 15 January 09:00 AEDT is 14 January 22:00 UTC: filtering "from 15 January"
 * excluded it, and "up to 14 January" included it. `Date.parse` on a date-only
 * string is UTC by spec; the explicit `T00:00:00` form is local by spec.
 */
function dayStartMs(day: string | null | undefined): number | null {
  if (day == null) return null;
  const parsed = new Date(`${day}T00:00:00`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function activeCanyonFilterCount(filters: CanyonFilters): number {
  const builtIn = COUNTED_FILTER_KEYS.reduce(
    (count, key) => count + (isFilterActive(filters, key) ? 1 : 0),
    0,
  );
  return builtIn + Object.keys(filters.custom ?? {}).length;
}

export function hasActiveCanyonFilters(filters: CanyonFilters): boolean {
  if (isFilterActive(filters, "name")) return true;
  return activeCanyonFilterCount(filters) > 0;
}

/** Free-text match over the primary name and every alternative name. */
export function canyonMatchesSearch(
  canyon: Pick<CanyonFilterFields, "name" | "altNames">,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  if (canyon.name.toLowerCase().includes(needle)) return true;
  return (canyon.altNames ?? []).some((alt) => alt.toLowerCase().includes(needle));
}

/**
 * isOwned distinguishes the viewer's own canyons from canyons shared with them.
 * It's structural (which list the canyon came from / its mirror sync role), so
 * it can't be read off the canyon — callers pass it per bucket.
 */
// isOwned distinguishes the owner's own canyons from canyons shared with them.
// It's structural (which list the canyon came from), so it can't be read off the
// canyon — callers pass it per bucket.
// "Done" = the viewer has run this canyon. Self-only: only readable for canyons
// the viewer owns. A trip can only link to its own owner's canyons, so on a canyon
// shared *with* the viewer `_count.tripLogLinks` is the OWNER's tally, not theirs —
// reading it would answer the wrong question and leak how often that friend runs it.
// A missing `_count` is a payload shape, not a data gap: zero trips is a real answer.
// Single source for both the completion filter and the map's completed-marker style.
export function isCanyonDoneByViewer(
  canyon: CanyonFilterFields,
  isOwned: boolean,
): boolean {
  return isOwned && (canyon._count?.tripLogLinks ?? 0) > 0;
}

export function passesCanyonFilters(
  canyon: CanyonFilterFields,
  filters: CanyonFilters,
  isOwned: boolean,
): boolean {
  const includeUnknowns = filters.include_unknowns;

  function passesRangeFilter(
    value: number | null | undefined,
    filter: number[] | null,
    bounds: readonly [number, number],
  ): boolean {
    if (filter && (filter[0] !== bounds[0] || filter[1] !== bounds[1])) {
      if (value == null) return includeUnknowns;
      if (value < filter[0] || value > filter[1]) return false;
    }
    return true;
  }

  function passesThresholdFilter(
    value: number | null | undefined,
    filter: CanyonThresholdFilter | null,
  ): boolean {
    if (filter && filter[0] !== "Any") {
      if (value == null) return includeUnknowns;
      if (filter[0] === "Less than" && value >= filter[1]) return false;
      if (filter[0] === "More than" && value <= filter[1]) return false;
      if (filter[0] === "Exactly" && value !== filter[1]) return false;
    }
    return true;
  }

  function passesDateRangeFilter(
    value: string | null | undefined,
    filter: CanyonDateRange | null,
  ): boolean {
    if (!filter) return true;
    const [start, end] = filter;
    if (start == null && end == null) return true;
    if (value == null) return includeUnknowns;
    const time = Date.parse(value);
    // A value the viewer can't place on a calendar can't be range-filtered.
    // Returning true here (which is what every NaN comparison did) meant a
    // custom date field holding "15/01/2026" matched EVERY range, in or out.
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

  if (filters.ownership === "owned" && !isOwned) return false;
  if (filters.ownership === "shared" && isOwned) return false;

  if (filters.shared_by_me && (canyon._count?.shares ?? 0) === 0) return false;

  // Completion asks "have *I* done it", so the trip count is only read for
  // canyons the viewer owns. A trip can only link to its own owner's canyons
  // (resolveTripCanyonIds enforces ownerId), so on a canyon shared *with* the
  // viewer `_count.tripLogLinks` is the OWNER's tally, not theirs — reading it
  // would answer the wrong question (marking a canyon done because a friend ran
  // it) and surface how often that friend runs it. The viewer structurally
  // cannot have a linked trip there, so a shared canyon is never "done".
  // Deliberately ignores include_unknowns: a missing `_count` is a payload
  // shape, not a data gap — zero trips is a real answer, not an unknown one.
  if (filters.completion !== "any") {
    const doneByViewer = isCanyonDoneByViewer(canyon, isOwned);
    if (filters.completion === "done" && !doneByViewer) return false;
    if (filters.completion === "not_done" && doneByViewer) return false;
  }

  if (filters.ropewiki === "linked" && canyon.ropeWikiId == null) return false;
  if (filters.ropewiki === "unlinked" && canyon.ropeWikiId != null) return false;

  if (filters.name && filters.name.trim() !== "") {
    if (!canyonMatchesSearch(canyon, filters.name)) return false;
  }

  if (!passesRangeFilter(canyon.vGrade, filters.v_grade, CANYON_RANGE_BOUNDS.v_grade))
    return false;
  if (!passesRangeFilter(canyon.aGrade, filters.a_grade, CANYON_RANGE_BOUNDS.a_grade))
    return false;
  if (
    !passesRangeFilter(canyon.commitment, filters.commitment, CANYON_RANGE_BOUNDS.commitment)
  )
    return false;
  if (!passesRangeFilter(canyon.quality, filters.quality, CANYON_RANGE_BOUNDS.quality))
    return false;
  if (!passesThresholdFilter(canyon.numAbseils, filters.pitches)) return false;
  if (!passesThresholdFilter(canyon.longestAbseil, filters.longest_pitch)) return false;
  if (!passesThresholdFilter(canyon.hours, filters.hours)) return false;
  if (!passesDateRangeFilter(canyon.createdAt, filters.created_at)) return false;
  if (!passesDateRangeFilter(canyon.updatedAt, filters.updated_at)) return false;

  for (const [key, filter] of Object.entries(filters.custom ?? {})) {
    const value = canyon.attributes?.customFields?.[key];
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
        if (!passesDateRangeFilter(String(value), filter.range)) return false;
        break;
    }
  }

  return true;
}

/**
 * Maps a custom-field definition to the filter kind it produces, so a stored
 * filter can be validated against the current definition. Bounded
 * integer/float fields render a range slider (numberRange); unbounded ones use
 * op+value.
 */
export function customFilterKind(
  def: TripLogCustomFieldDef,
): CanyonCustomFieldFilter["kind"] {
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
 * Drops custom-field filters that no longer correspond to a live definition
 * (deleted field) or whose stored kind no longer matches the field's type
 * (deleted-then-recreated with a different type). Returns the same reference
 * when nothing changes so callers can rely on identity stability.
 */
export function reconcileCustomFilters(
  filters: CanyonFilters,
  defs: TripLogCustomFieldDef[],
): CanyonFilters {
  const current = filters.custom ?? {};
  const next: Record<string, CanyonCustomFieldFilter> = {};
  for (const [key, filter] of Object.entries(current)) {
    const def = defs.find((d) => d.key === key);
    if (def && customFilterKind(def) === filter.kind) {
      next[key] = filter;
    }
  }
  if (Object.keys(next).length === Object.keys(current).length) return filters;
  return { ...filters, custom: next };
}

/**
 * Sort orders offered for a canyon list. `recent` = newest first; `grade` =
 * easiest first (V then A); `quality` = best first. Nulls sort last for every
 * key so canyons missing the sort field don't crowd the top, and every
 * comparison falls back to name so the order is total and stable.
 */
export type CanyonSortKey = "name" | "recent" | "grade" | "quality";

export function compareCanyons(
  a: CanyonFilterFields,
  b: CanyonFilterFields,
  sort: CanyonSortKey,
): number {
  switch (sort) {
    case "recent":
      return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    case "grade": {
      const av = a.vGrade ?? Infinity;
      const bv = b.vGrade ?? Infinity;
      if (av !== bv) return av - bv;
      const aa = a.aGrade ?? Infinity;
      const ba = b.aGrade ?? Infinity;
      if (aa !== ba) return aa - ba;
      return a.name.localeCompare(b.name);
    }
    case "quality": {
      // Best first, so a missing rating sorts to the bottom rather than the top.
      const aq = a.quality ?? -Infinity;
      const bq = b.quality ?? -Infinity;
      if (aq !== bq) return bq - aq;
      return a.name.localeCompare(b.name);
    }
    case "name":
    default:
      return a.name.localeCompare(b.name);
  }
}
