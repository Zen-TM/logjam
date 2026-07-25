/**
 * Trip-log list filtering — the single derivation shared by the web Trip Logs
 * panel and the mobile Logs screen. Both offer the same four axes (free-text
 * over canyon/trip name, an inclusive from/to date range, and a trip type), so
 * the predicate lives here rather than being written twice with subtly
 * different edge cases.
 *
 * Dates: trip dates are stored as UTC-midnight date-only values, and the range
 * bounds are "YYYY-MM-DD" strings that `Date` also parses as UTC midnight — so
 * both ends of the range are inclusive of trips falling exactly on them. Never
 * compare these in local time (CH-001: AEST renders/compares the prior day).
 */

/** The type-filter value meaning "trips with no type at all". Distinct from
 * `""` (any type), which never matches an actual `types` entry. */
export const NO_TYPE_FILTER_VALUE = "__no_type__";

export type TripFilterCriteria = {
  /** Matches canyon names or the trip's own display name, case-insensitively. */
  search?: string;
  /** Inclusive lower bound, "YYYY-MM-DD". */
  dateFrom?: string;
  /** Inclusive upper bound, "YYYY-MM-DD". */
  dateTo?: string;
  /** A type label, `NO_TYPE_FILTER_VALUE`, or "" for any. */
  type?: string;
};

/** The subset of a trip log the filter reads — keeps this usable from both
 * clients' trip types without importing either. */
export type FilterableTrip = {
  date: string;
  displayName: string | null;
  types: string[];
  canyons: { name: string }[];
};

export function tripMatchesFilter(
  trip: FilterableTrip,
  criteria: TripFilterCriteria,
): boolean {
  const search = criteria.search?.trim().toLowerCase();
  if (search) {
    const matches =
      trip.canyons.some((canyon) => canyon.name.toLowerCase().includes(search)) ||
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
  return true;
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
    criteria.search?.trim() || criteria.dateFrom || criteria.dateTo || criteria.type,
  );
}

/** Distinct type labels across a trip set, sorted for a stable filter list. */
export function distinctTripTypes(trips: FilterableTrip[]): string[] {
  return Array.from(new Set(trips.flatMap((trip) => trip.types))).sort((a, b) =>
    a.localeCompare(b),
  );
}
