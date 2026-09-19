/**
 * Trip-log list filtering — the single derivation shared by the web Trip Logs
 * panel and the mobile Logs screen. Both offer the same axes (free-text over
 * place/trip name, an inclusive from/to date range, a trip type, and a filter
 * per trip ATTRIBUTE), so the predicate lives here rather than being written
 * twice with subtly different edge cases.
 *
 * The attribute axes answer the same question a place's do and are answered by
 * the same code (`passesCustomFieldFilters`): a trip's values live in
 * `customFields` and a place's in `fieldValues`, and that is the only
 * difference between them. Writing the five-kind switch a second time here
 * would have been a second set of edge cases to get wrong.
 *
 * Dates: trip dates are stored as UTC-midnight date-only values, and the range
 * bounds are "YYYY-MM-DD" strings that `Date` also parses as UTC midnight — so
 * both ends of the range are inclusive of trips falling exactly on them. Never
 * compare these in local time (CH-001: AEST renders/compares the prior day).
 */

import {
  passesCustomFieldFilters,
  type CustomFieldFilter,
} from "./customFieldFilter.js";

/** The type-filter value meaning "trips with no type at all". Distinct from
 * `""` (any type), which never matches an actual `types` entry. */
export const NO_TYPE_FILTER_VALUE = "__no_type__";

export type TripFilterCriteria = {
  /** Matches place names or the trip's own display name, case-insensitively. */
  search?: string;
  /** Inclusive lower bound, "YYYY-MM-DD". */
  dateFrom?: string;
  /** Inclusive upper bound, "YYYY-MM-DD". */
  dateTo?: string;
  /** A type label, `NO_TYPE_FILTER_VALUE`, or "" for any. */
  type?: string;
  /**
   * Active attribute filters keyed by field key. Only active filters are
   * present — an inactive one is ABSENT, never present at its default, so "is
   * this axis filtering" stays `key in custom` for every kind.
   */
  custom?: Record<string, CustomFieldFilter>;
  /**
   * Whether a trip that never answered a filtered attribute still matches.
   * Widens rather than narrows, exactly as a place's `include_unknowns` does,
   * and for the same reason: most trips answer most fields not at all, so
   * without the choice an attribute filter silently empties the list.
   */
  includeUnknowns?: boolean;
};

/** The subset of a trip log the filter reads — keeps this usable from both
 * clients' trip types without importing either. */
export type FilterableTrip = {
  date: string;
  displayName: string | null;
  types: string[];
  places: { name: string }[];
  /** The trip's own answers, keyed by CustomFieldDef.key. Absent on callers
   *  that only filter the four original axes. */
  customFields?: Record<string, unknown> | null;
};

export function tripMatchesFilter(
  trip: FilterableTrip,
  criteria: TripFilterCriteria,
): boolean {
  const search = criteria.search?.trim().toLowerCase();
  if (search) {
    const matches =
      trip.places.some((place) => place.name.toLowerCase().includes(search)) ||
      (trip.displayName?.toLowerCase().includes(search) ?? false);
    if (!matches) return false;
  }
  if (criteria.dateFrom && new Date(trip.date) < new Date(criteria.dateFrom)) {
    return false;
  }
  if (criteria.dateTo && new Date(trip.date) > new Date(criteria.dateTo)) {
    return false;
  }
  if (criteria.type === NO_TYPE_FILTER_VALUE) {
    if (trip.types.length > 0) return false;
  } else if (criteria.type) {
    if (!trip.types.includes(criteria.type)) return false;
  }
  return passesCustomFieldFilters(
    trip.customFields,
    criteria.custom,
    criteria.includeUnknowns ?? false,
  );
}

export function filterTrips<T extends FilterableTrip>(
  trips: T[],
  criteria: TripFilterCriteria,
): T[] {
  return trips.filter((trip) => tripMatchesFilter(trip, criteria));
}

/** True when any axis is actually narrowing the list — drives the "clear
 * filters" affordance, which must not appear when nothing is filtered. */
export function hasActiveTripFilter(criteria: TripFilterCriteria): boolean {
  return Boolean(
    criteria.search?.trim() ||
      criteria.dateFrom ||
      criteria.dateTo ||
      criteria.type ||
      Object.keys(criteria.custom ?? {}).length > 0,
  );
}

/** How many axes are narrowing the list — the number the "3 filters active"
 *  strip states. `includeUnknowns` WIDENS, so it is not one of them, and
 *  neither is the sort. */
export function activeTripFilterCount(criteria: TripFilterCriteria): number {
  const builtIn =
    (criteria.search?.trim() ? 1 : 0) +
    (criteria.dateFrom || criteria.dateTo ? 1 : 0) +
    (criteria.type ? 1 : 0);
  return builtIn + Object.keys(criteria.custom ?? {}).length;
}

/**
 * The order a trip list runs in. A logbook is chronological — the question is
 * only which end you start from — so this is two options and not a sort menu.
 * `newest` is the default everywhere and the one DESIGN.md §5 mandates for the
 * resting list; `oldest` is for reading a season forwards.
 */
export type TripSortKey = "newest" | "oldest";

export const TRIP_SORT_OPTIONS: { key: TripSortKey; label: string }[] = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
];

/** Sorts a COPY. Stable, so trips sharing a date keep the order they arrived
 *  in rather than shuffling as the user flips the axis. */
export function sortTrips<T extends FilterableTrip>(
  trips: T[],
  sort: TripSortKey,
): T[] {
  const direction = sort === "oldest" ? 1 : -1;
  return [...trips].sort(
    (a, b) => direction * (Date.parse(a.date) - Date.parse(b.date)),
  );
}

/** Distinct type labels across a trip set, sorted for a stable filter list. */
export function distinctTripTypes(trips: FilterableTrip[]): string[] {
  return Array.from(new Set(trips.flatMap((trip) => trip.types))).sort((a, b) =>
    a.localeCompare(b),
  );
}
