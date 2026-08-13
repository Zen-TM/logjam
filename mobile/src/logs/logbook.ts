/**
 * Pure derivations for the Logs screen — grouping, tallies and date labels.
 * RN-free so it is unit-testable.
 *
 * Every STORED date read here is UTC: trip dates are UTC-midnight date-only
 * values, and formatting or bucketing them in local time renders the previous
 * calendar day for anyone east of Greenwich (CH-001). The exception is a `now`
 * argument, which is a real-clock instant and is read in local fields — see
 * `currentCalendarMonth`. Reading UTC fields off the wall clock is the same
 * bug in the other direction, and `logbook.test.ts` pins both under a non-UTC
 * timezone.
 */

export type LogbookTrip = {
  date: string;
  canyons: { id: string; name: string }[];
};

/** "Sun 15 Mar 2026" — a logbook entry's own line; the year group supplies context. */
export function formatTripDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "15 Mar 2026" — where the weekday would be noise (sheet titles, filter summaries). */
export function formatDateKey(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function tripYear(isoDate: string): number {
  return new Date(isoDate).getUTCFullYear();
}

/**
 * Trips bucketed by calendar year, newest year first, preserving the input
 * order inside each year (the mirror already sorts date-descending).
 *
 * A chronological list groups by time, not by category — this is an ordering
 * aid under the filter rail, not the stacked-sections pattern the rail
 * replaced.
 */
export function groupTripsByYear<T extends { date: string }>(
  trips: T[],
): { year: number; trips: T[] }[] {
  const byYear = new Map<number, T[]>();
  for (const trip of trips) {
    const year = tripYear(trip.date);
    const bucket = byYear.get(year);
    if (bucket) bucket.push(trip);
    else byYear.set(year, [trip]);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, yearTrips]) => ({ year, trips: yearTrips }));
}

/** Distinct canyons across a trip set — "how much of the library have I done". */
export function distinctCanyonCount(trips: LogbookTrip[]): number {
  return new Set(trips.flatMap((trip) => trip.canyons.map((canyon) => canyon.id))).size;
}

export type MonthBucket = { label: string; count: number; current: boolean };

/**
 * The calendar month the user is actually in, from a real-clock instant.
 *
 * `now` is the ONE value in this module that is an instant rather than a stored
 * date-only value, so it is the one value read in LOCAL fields: east of
 * Greenwich `now.getUTCMonth()` still says yesterday for the first 10-11 hours
 * of every local day, which put the spark's "current" bucket — and the start of
 * the recent-trips window — on the wrong month for the whole of the 1st of the
 * month, every month. Stored trip dates are UTC midnight OF THE USER'S LOCAL
 * DAY (see `fromDateKey`/`todayDateKey` in ui/monthGrid.ts), so their UTC month
 * and this local month are the same calendar month, which is what makes the
 * comparison below sound.
 */
function currentCalendarMonth(now: Date): { year: number; month: number } {
  return { year: now.getFullYear(), month: now.getMonth() };
}

/**
 * Trips per month over the `months` calendar months ending with the one `now`
 * falls in — the activity spark's input. Labels are the month's initial, which
 * repeats (J/J, M/M); the axis is a shape, and the caption carries the range.
 */
export function monthlyTripCounts(
  trips: { date: string }[],
  now: Date = new Date(),
  months = 12,
): MonthBucket[] {
  const { year: endYear, month: endMonth } = currentCalendarMonth(now);
  const counts = new Map<string, number>();
  for (const trip of trips) {
    const date = new Date(trip.date);
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const buckets: MonthBucket[] = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const total = endYear * 12 + endMonth - offset;
    const year = Math.floor(total / 12);
    const month = ((total % 12) + 12) % 12;
    buckets.push({
      label: new Date(Date.UTC(year, month, 1))
        .toLocaleDateString("en-AU", { month: "narrow", timeZone: "UTC" })
        .charAt(0),
      count: counts.get(`${year}-${month}`) ?? 0,
      current: offset === 0,
    });
  }
  return buckets;
}

/** Trips whose date falls in the window the spark covers. */
export function countTripsInLastMonths(
  trips: { date: string }[],
  now: Date = new Date(),
  months = 12,
): number {
  const { year, month } = currentCalendarMonth(now);
  const total = year * 12 + month - (months - 1);
  const start = Date.UTC(Math.floor(total / 12), ((total % 12) + 12) % 12, 1);
  return trips.filter((trip) => new Date(trip.date).getTime() >= start).length;
}
