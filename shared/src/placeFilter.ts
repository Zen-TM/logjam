// Place filtering — the single source of the "which places match" decision,
// shared by the web Places panel and the mobile Places screen.
//
// Moved here from frontend/src/placeUtils.ts when mobile needed the same
// rules: a forked predicate means the two clients disagree about what "V3–5,
// include unknowns" means, and the disagreement shows up as places that exist
// on one device and not the other. `placeUtils` re-exports these under their
// original names, so web callers are unchanged.
//
// PRIVACY: pure predicates over values the caller already holds. Nothing here
// logs. The `area` filter is the one place a coordinate reaches this module —
// it is a box the user drew on their own map, compared against place
// positions the caller already has in memory. It is never logged and never
// sent anywhere; the clients decide what they persist (see the `area` field).
import { fieldValue, numericFieldValue } from "./fieldValues.js";
import type { RegionBbox } from "./mapRegionEstimate.js";
import type { TripLogCustomFieldDef } from "./tripLogFields.js";

/** [start, end] inclusive ISO-date bounds (yyyy-mm-dd); either bound nullable. */
export type PlaceDateRange = [string | null, string | null];

/**
 * A single active custom-field filter. Self-describing (carries its own kind)
 * so the predicate can apply it without consulting the field definitions. The
 * kind maps from the field's TripLogCustomFieldType: string→text,
 * integer/float→number, date→date, boolean→boolean.
 */
export type PlaceCustomFieldFilter =
  | { kind: "text"; value: string }
  | { kind: "number"; op: "Less than" | "More than" | "Exactly"; value: number }
  // Inclusive [min, max] range for bounded integer/float fields; rendered as a
  // double-ended slider. Full span commits as null (the inactive state).
  | { kind: "numberRange"; range: [number, number] }
  | { kind: "date"; range: PlaceDateRange }
  | { kind: "boolean"; value: boolean };

export type PlaceThresholdFilter = [
  "Any" | "Less than" | "More than" | "Exactly",
  number,
];

export type PlaceFilters = {
  name: string | null;
  /**
   * The seven graded axes USED TO LIVE HERE as named fields (`v_grade`,
   * `pitches`, ...). They are ordinary custom-field filters now, in `custom`,
   * because the columns they read became field values and a place of a
   * user-made type has no grades at all. Two of them changed key on the way:
   * `pitches` -> `num_abseils` and `longest_pitch` -> `longest_abseil`, which
   * are the reserved keys the values are actually stored under.
   *
   * Nothing is lost: a bounded def still renders as a double-ended slider
   * (`numberRange`) and a min-only one as op+value (`number`) — the same two
   * shapes the named fields had, now chosen from the definition instead of
   * hardcoded. And a user's own bounded field gets the slider too, which it
   * never did before.
   */
  /** Keep only places of this type; null = every type. */
  placeTypeId: string | null;
  ownership: "all" | "owned" | "shared";
  /** When true, keep only places the user has shared with at least one friend. */
  shared_by_me: boolean;
  /**
   * "Have I done it?" — a place is done once it has at least one linked trip,
   * the same rule the analytics completion ring counts (placesWithTrips).
   */
  completion: "any" | "done" | "not_done";
  created_at: PlaceDateRange | null;
  updated_at: PlaceDateRange | null;
  ropewiki: "any" | "linked" | "unlinked";
  /**
   * Keep only places whose position falls inside this box (inclusive on all
   * four edges). Drawn by the user on a map; null when no area is set.
   *
   * NSW-only product, so no antimeridian case: `west <= east` always holds and
   * a box that wrapped 180° would need a different comparison.
   */
  area: RegionBbox | null;
  /**
   * Active custom-field filters keyed by field key. Only active filters are
   * present; clearing a field deletes its key. Empty {} means none active.
   */
  custom: Record<string, PlaceCustomFieldFilter>;
  include_unknowns: boolean;
};

/**
 * The place shape the predicate actually reads — structural, so both the web
 * `TPlace` and the mobile mirror row satisfy it without either importing the
 * other's type.
 *
 * `_count` is optional because on a place shared WITH the viewer these counts
 * are absent by design, not zero: the trip tally is the owner's private
 * trip-list cardinality and `shares` is their fan-out to other people, so the
 * API withholds both. Absent means "not yours to know" — never coalesce it to 0
 * and present that as an answer about a shared place. The mobile mirror
 * likewise has no `_count` column; it fills this in from locally derived
 * counts before filtering.
 */
export type PlaceFilterFields = {
  name: string;
  altNames?: string[];
  /**
   * Required, not optional: `Place.latitude`/`longitude` are non-null in the
   * schema and on the mobile mirror, so the `area` filter has no unknown case
   * to fold into `include_unknowns` the way the graded axes do.
   */
  latitude: number;
  longitude: number;
  /** The type this place belongs to, for the per-type tab/layer filter. */
  placeTypeId?: string;
  /** Type-specific values, keyed by definition key. Replaces the seven grade
   *  scalars AND the `attributes.customFields` sub-object they sat beside —
   *  which is the whole point: a value keyed `v_grade` and a user's own value
   *  are now read the same way, through the same predicate. */
  fieldValues?: unknown;
  ropeWikiId?: number | null;
  createdAt?: string;
  updatedAt?: string;
  _count?: { tripLogLinks: number; shares: number };
};

export const EMPTY_PLACE_FILTERS: PlaceFilters = {
  name: null,
  placeTypeId: null,
  ownership: "all",
  shared_by_me: false,
  completion: "any",
  created_at: null,
  updated_at: null,
  ropewiki: "any",
  area: null,
  custom: {},
  include_unknowns: false,
};

// PLACE_RANGE_BOUNDS and PLACE_THRESHOLD_KEYS are GONE. They restated the
// bounds of the seven grade columns, which are now the `min`/`max` of the
// system field definitions — so keeping them would have been two lists that
// must agree, with the UI silently offering a slider over the wrong span when
// they stopped. A range filter's bounds come from the definition now
// (`customFilterKind`), which is also why a user's own bounded field finally
// gets the same slider.
const DATE_FILTER_KEYS = ["created_at", "updated_at"] as const;

/**
 * True when a single filter field is set to anything other than its inactive
 * default. Single source of truth for the count and the "any active" test.
 */
function isFilterActive(filters: PlaceFilters, key: keyof PlaceFilters): boolean {
  if (key === "name") return !!filters.name && filters.name.trim() !== "";
  if (key === "ownership") return filters.ownership !== "all";
  if (key === "shared_by_me") return filters.shared_by_me;
  if (key === "completion") return filters.completion !== "any";
  if (key === "ropewiki") return filters.ropewiki !== "any";
  if (key === "area") return filters.area != null;
  if (key === "placeTypeId") return filters.placeTypeId != null;
  if (key === "include_unknowns") return false; // a modifier, not a filter
  if ((DATE_FILTER_KEYS as readonly string[]).includes(key)) {
    const value = filters[key] as PlaceDateRange | null;
    return !!value && (value[0] != null || value[1] != null);
  }
  return false;
}

// Everything a badge counts: the filters that hide places (excluding `name`,
// which lives in its own search box, and include_unknowns).
//
// Exported for its guard test, not for callers: this list and the fields of
// `PlaceFilters` must agree, and nothing in the type system makes them. A key
// added to the type and forgotten here hides places while the badge reads
// zero and "Clear filters" looks like it has nothing to clear.
// `UNCOUNTED_FILTER_KEYS` is the other half of that pair — every field is in
// exactly one of the two, and `placeFilter.test.ts` fails when one isn't.
export const COUNTED_FILTER_KEYS: (keyof PlaceFilters)[] = [
  ...DATE_FILTER_KEYS,
  "placeTypeId",
  "ownership",
  "shared_by_me",
  "completion",
  "ropewiki",
  "area",
];

/**
 * The fields a badge deliberately does NOT count: `name` has its own search
 * box, `include_unknowns` widens rather than hides, and `custom` is counted by
 * its entries instead of as one field.
 */
export const UNCOUNTED_FILTER_KEYS: (keyof PlaceFilters)[] = [
  "name",
  "include_unknowns",
  "custom",
];

/**
 * Midnight of a `yyyy-mm-dd` bound in the VIEWER's timezone, or null if it
 * isn't a usable date.
 *
 * `created_at`/`updated_at` are real instants, and the bounds were parsed as
 * UTC midnight — so in Sydney (UTC+10/+11) everything added between local
 * midnight and 11:00 filed under the previous day. A place added
 * 15 January 09:00 AEDT is 14 January 22:00 UTC: filtering "from 15 January"
 * excluded it, and "up to 14 January" included it. `Date.parse` on a date-only
 * string is UTC by spec; the explicit `T00:00:00` form is local by spec.
 */
function dayStartMs(day: string | null | undefined): number | null {
  if (day == null) return null;
  const parsed = new Date(`${day}T00:00:00`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function activePlaceFilterCount(filters: PlaceFilters): number {
  const builtIn = COUNTED_FILTER_KEYS.reduce(
    (count, key) => count + (isFilterActive(filters, key) ? 1 : 0),
    0,
  );
  return builtIn + Object.keys(filters.custom ?? {}).length;
}

export function hasActivePlaceFilters(filters: PlaceFilters): boolean {
  if (isFilterActive(filters, "name")) return true;
  return activePlaceFilterCount(filters) > 0;
}

/** Free-text match over the primary name and every alternative name. */
export function placeMatchesSearch(
  place: Pick<PlaceFilterFields, "name" | "altNames">,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  if (place.name.toLowerCase().includes(needle)) return true;
  return (place.altNames ?? []).some((alt) => alt.toLowerCase().includes(needle));
}

/**
 * isOwned distinguishes the viewer's own places from places shared with them.
 * It's structural (which list the place came from / its mirror sync role), so
 * it can't be read off the place — callers pass it per bucket.
 */
// isOwned distinguishes the owner's own places from places shared with them.
// It's structural (which list the place came from), so it can't be read off the
// place — callers pass it per bucket.
// "Visited" = the viewer has at least one trip logged against this place, and
// the label says exactly that: the predicate cannot tell a finished descent from
// a bail, so "Done" overclaimed. Self-only: only readable for places
// the viewer owns. A trip can only link to its own owner's places, so on a place
// shared *with* the viewer `_count.tripLogLinks` is the OWNER's tally, not theirs —
// reading it would answer the wrong question and leak how often that friend runs it.
// A missing `_count` is a payload shape, not a data gap: zero trips is a real answer.
// Single source for both the completion filter and the map's completed-marker style.
export function isPlaceDoneByViewer(
  place: PlaceFilterFields,
  isOwned: boolean,
): boolean {
  return isOwned && (place._count?.tripLogLinks ?? 0) > 0;
}

/**
 * Inclusive on all four edges. Exported because the box is drawn on one screen
 * and applied on another: any surface that wants "is this place in the area"
 * asks here rather than re-deriving the comparison and getting an edge wrong.
 */
export function isPlaceInArea(
  place: Pick<PlaceFilterFields, "latitude" | "longitude">,
  area: RegionBbox,
): boolean {
  return (
    place.latitude >= area.south &&
    place.latitude <= area.north &&
    place.longitude >= area.west &&
    place.longitude <= area.east
  );
}

export function passesPlaceFilters(
  place: PlaceFilterFields,
  filters: PlaceFilters,
  isOwned: boolean,
): boolean {
  const includeUnknowns = filters.include_unknowns;

  function passesDateRangeFilter(
    value: string | null | undefined,
    filter: PlaceDateRange | null,
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

  if (filters.shared_by_me && (place._count?.shares ?? 0) === 0) return false;

  // Completion asks "have *I* done it", so the trip count is only read for
  // places the viewer owns. A trip can only link to its own owner's places
  // (resolveTripPlaceIds enforces ownerId), so on a place shared *with* the
  // viewer `_count.tripLogLinks` is the OWNER's tally, not theirs — reading it
  // would answer the wrong question (marking a place done because a friend ran
  // it) and surface how often that friend runs it. The viewer structurally
  // cannot have a linked trip there, so a shared place is never "done".
  // Deliberately ignores include_unknowns: a missing `_count` is a payload
  // shape, not a data gap — zero trips is a real answer, not an unknown one.
  if (filters.completion !== "any") {
    const doneByViewer = isPlaceDoneByViewer(place, isOwned);
    if (filters.completion === "done" && !doneByViewer) return false;
    if (filters.completion === "not_done" && doneByViewer) return false;
  }

  if (filters.ropewiki === "linked" && place.ropeWikiId == null) return false;
  if (filters.ropewiki === "unlinked" && place.ropeWikiId != null) return false;

  if (filters.area && !isPlaceInArea(place, filters.area)) return false;

  if (filters.name && filters.name.trim() !== "") {
    if (!placeMatchesSearch(place, filters.name)) return false;
  }

  if (filters.placeTypeId != null && place.placeTypeId !== filters.placeTypeId) {
    return false;
  }

  if (!passesDateRangeFilter(place.createdAt, filters.created_at)) return false;
  if (!passesDateRangeFilter(place.updatedAt, filters.updated_at)) return false;

  for (const [key, filter] of Object.entries(filters.custom ?? {})) {
    const value = fieldValue(place.fieldValues, key);
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
): PlaceCustomFieldFilter["kind"] {
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
  filters: PlaceFilters,
  defs: TripLogCustomFieldDef[],
): PlaceFilters {
  const current = filters.custom ?? {};
  const next: Record<string, PlaceCustomFieldFilter> = {};
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
 * Sort orders offered for a place list. `recent` = newest first; `grade` =
 * easiest first (V then A); `quality` = best first. Nulls sort last for every
 * key so places missing the sort field don't crowd the top, and every
 * comparison falls back to name so the order is total and stable.
 */
export type PlaceSortKey = "name" | "recent" | "grade" | "quality";

export function comparePlaces(
  a: PlaceFilterFields,
  b: PlaceFilterFields,
  sort: PlaceSortKey,
): number {
  switch (sort) {
    case "recent":
      return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    case "grade": {
      // Reads the reserved canyon keys out of `fieldValues`. A place of a type
      // that has no grades sorts to the bottom, exactly as an ungraded canyon
      // always did — same rule, one fewer special case.
      const av = numericFieldValue(a.fieldValues, "v_grade") ?? Infinity;
      const bv = numericFieldValue(b.fieldValues, "v_grade") ?? Infinity;
      if (av !== bv) return av - bv;
      const aa = numericFieldValue(a.fieldValues, "a_grade") ?? Infinity;
      const ba = numericFieldValue(b.fieldValues, "a_grade") ?? Infinity;
      if (aa !== ba) return aa - ba;
      return a.name.localeCompare(b.name);
    }
    case "quality": {
      // Best first, so a missing rating sorts to the bottom rather than the top.
      const aq = numericFieldValue(a.fieldValues, "quality") ?? -Infinity;
      const bq = numericFieldValue(b.fieldValues, "quality") ?? -Infinity;
      if (aq !== bq) return bq - aq;
      return a.name.localeCompare(b.name);
    }
    case "name":
    default:
      return a.name.localeCompare(b.name);
  }
}
