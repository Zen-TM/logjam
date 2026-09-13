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

import { todayDateKey } from "../ui/monthGrid";

export type LogbookTrip = {
  date: string;
  places: { id: string; name: string }[];
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

/** Distinct places across a trip set — "how much of the library have I done". */
export function distinctPlaceCount(trips: LogbookTrip[]): number {
  return new Set(trips.flatMap((trip) => trip.places.map((place) => place.id))).size;
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

// ── Ranges and spark buckets for the stats screen ──────────────────────

export type LogbookRange = { label: string; from: string | null; to: string | null };

/**
 * The relative ranges people actually ask for, relative to now.
 *
 * LOCAL today, not UTC. In AEDT before 11:00 the UTC date is yesterday, so
 * "This year" was labelled with last year on New Year's morning and, every
 * other morning, set `to` = yesterday and hid a trip logged today. The Logs
 * screen already disables future days by local today, so the sheet was
 * disagreeing with itself.
 *
 * Declared once and read twice: the Logs filter sheet offers these as presets,
 * and the stats screen's pill rail leads with them. The two surfaces must mean
 * the same thing by "This year".
 */
export function datePresets(today: string = todayDateKey()): LogbookRange[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const twelveMonths = new Date(Date.UTC(year, month - 11, 1))
    .toISOString()
    .slice(0, 10);
  return [
    { label: "This year", from: `${year}-01-01`, to: today },
    { label: "Last 12 months", from: twelveMonths, to: today },
    { label: `${year - 1}`, from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
  ];
}

/**
 * The stats screen's pill rail: all time, the relative presets, then one pill
 * per EARLIER year the user actually has trips in.
 *
 * Derived from the data rather than hardcoded, which is what makes a
 * side-scrolling rail earn itself — it grows a pill per season rather than
 * offering four empty windows to someone who started last month. The two years
 * `datePresets` already covers are skipped so no year appears twice.
 */
export function logbookRanges(
  years: number[],
  today: string = todayDateKey(),
): LogbookRange[] {
  const thisYear = Number(today.slice(0, 4));
  const covered = new Set([thisYear, thisYear - 1]);
  return [
    { label: "All time", from: null, to: null },
    ...datePresets(today),
    ...[...new Set(years)]
      .filter((year) => !covered.has(year))
      .sort((a, b) => b - a)
      .map((year) => ({
        label: `${year}`,
        from: `${year}-01-01`,
        to: `${year}-12-31`,
      })),
  ];
}

/** Twelve calendar-month buckets for ONE year — the spark for a year pill,
 *  where "the last twelve months ending now" would be twelve empty bars. */
export function monthBucketsForYear(
  monthly: { year: number; month: number; count: number }[],
  year: number,
  now: Date = new Date(),
): MonthBucket[] {
  const current = currentCalendarMonth(now);
  return Array.from({ length: 12 }, (_, month) => ({
    label: new Date(Date.UTC(2000, month, 1))
      .toLocaleDateString("en-AU", { month: "narrow", timeZone: "UTC" })
      .charAt(0),
    count:
      monthly.find((entry) => entry.year === year && entry.month === month)?.count ??
      0,
    current: current.year === year && current.month === month,
  }));
}

/**
 * One bucket per calendar year from the first with a trip to the last, EMPTY
 * YEARS INCLUDED — a year off is part of the shape, and dropping it would draw
 * a continuous run of seasons that never happened.
 */
export function yearBuckets(
  yearly: { year: number; count: number }[],
  now: Date = new Date(),
): MonthBucket[] {
  if (yearly.length === 0) return [];
  const first = yearly[0].year;
  const last = yearly[yearly.length - 1].year;
  const thisYear = now.getFullYear();
  return Array.from({ length: last - first + 1 }, (_, offset) => {
    const year = first + offset;
    return {
      label: `${year}`.slice(2),
      count: yearly.find((entry) => entry.year === year)?.count ?? 0,
      current: year === thisYear,
    };
  });
}
