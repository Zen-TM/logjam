/**
 * Pure derivations for a logbook — grouping, tallies, date labels, the stats
 * ranges and spark buckets — shared by Logjam GPS's Logs and Stats screens and
 * Logjam Web's Logs page, so "This year" or a trip's date line cannot mean one
 * thing on a phone and another in a browser.
 *
 * Every STORED date read here is UTC: trip dates are UTC-midnight date-only
 * values, and formatting or bucketing them in local time renders the previous
 * calendar day for anyone east of Greenwich (CH-001). The exception is a `now`
 * argument, which is a real-clock instant and is read in local fields — see
 * `currentCalendarMonth`. Reading UTC fields off the wall clock is the same
 * bug in the other direction, and `logbook.test.ts` pins both under a non-UTC
 * timezone.
 */

import {
  UNTAGGED_ACTIVITY,
  type ActivityTally,
  type FieldStat,
  type LogbookStats,
} from "./logbookStats.js";
import { tripTypeLabel } from "./tripTypeIdentity.js";

export type LogbookTrip = {
  date: string;
  places: { id: string; name: string }[];
};

/**
 * The user's own calendar day, as a "YYYY-MM-DD" key.
 *
 * NOT `new Date().toISOString().slice(0, 10)`: that reads the clock in UTC, so
 * east of Greenwich it still says yesterday for the first hours of every local
 * day — the trip form marked the current day as "future" every AEST morning.
 */
export function todayDateKey(now: Date = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

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

/** "1 Jan 2026 → Today": a date filter summarised in words. Either bound may be
 *  open ("YYYY-MM-DD" or null). */
export function dateRangeLabel(from: string | null, to: string | null): string {
  const start = from ? formatDateKey(`${from}T00:00:00.000Z`) : "Any time";
  const end = to ? formatDateKey(`${to}T00:00:00.000Z`) : "Today";
  return `${start} → ${end}`;
}

/**
 * "Any", "2026-01-01 – 2026-03-31", "From 2026-01-01" — a date filter summarised
 * for the COLLAPSED field that holds it, in the raw bounds the user typed.
 *
 * Distinct from `dateRangeLabel`, which always names both ends in prose
 * ("1 Jan 2026 → Today") for a strip the user reads at a glance. This one says
 * "Any" when nothing is set, because a collapsed filter field has to state that
 * it is not filtering.
 */
export function dateSummary(
  range: readonly [string | null, string | null] | null,
): string {
  if (range == null || (range[0] == null && range[1] == null)) return "Any";
  if (range[0] != null && range[1] != null) return `${range[0]} – ${range[1]}`;
  return range[0] != null ? `From ${range[0]}` : `To ${range[1]}`;
}

export function tripYear(isoDate: string): number {
  return new Date(isoDate).getUTCFullYear();
}

/**
 * Trips bucketed by calendar year, newest year first, preserving the input
 * order inside each year (both clients already sort date-descending).
 *
 * A chronological list groups by time, not by category — this is an ordering
 * aid under the filter rail, not the stacked-sections pattern the rail
 * replaced.
 */
export function groupTripsByYear<T extends { date: string }>(
  trips: T[],
  // The year headings run the same way the trips inside them do. Fixed at
  // newest-first, "Oldest first" put 2019 at the bottom of the panel and
  // January at the top of it (2026-09-17).
  order: "newest" | "oldest" = "newest",
): { year: number; trips: T[] }[] {
  const byYear = new Map<number, T[]>();
  for (const trip of trips) {
    const year = tripYear(trip.date);
    const bucket = byYear.get(year);
    if (bucket) bucket.push(trip);
    else byYear.set(year, [trip]);
  }
  return [...byYear.entries()]
    .sort((a, b) => (order === "oldest" ? a[0] - b[0] : b[0] - a[0]))
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
 * DAY (`todayDateKey`), so their UTC month and this local month are the same
 * calendar month, which is what makes the comparison below sound.
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
 * other morning, set `to` = yesterday and hid a trip logged today.
 *
 * Declared once and read in three places: both clients' Logs date filters offer
 * these as presets, and the stats pill rail leads with them. They must all mean
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
 * The stats pill rail: all time, the relative presets, then one pill per
 * EARLIER year the user actually has trips in.
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

// ── Stats presentation: what both stats screens SAY ────────────────────
//
// `computeLogbookStats` decides the numbers; these decide how the two stats
// screens word and arrange them, so the phone and the browser read out the same
// sentence for the same number. Each is a rule a stats screen already learned
// the hard way (the comments say which).

/** The label a tag-less trip is filed under, everywhere on a stats screen. */
export const UNTAGGED_ACTIVITY_LABEL = "Untagged";

export function logbookActivityLabel(type: string): string {
  return type === UNTAGGED_ACTIVITY ? UNTAGGED_ACTIVITY_LABEL : tripTypeLabel(type);
}

export function pluralCount(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A rounded number for a stat — a mean of 4.333 is noise at two decimals and a
 *  lie at zero, so ratings keep one place and counts keep none. */
export function formatStatNumber(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

export type StatsSpark =
  | { axis: "month"; year: number; buckets: MonthBucket[] }
  | { axis: "year"; firstYear: number; buckets: MonthBucket[] };

/**
 * Months or years, decided by what the range actually spans.
 *
 * All time over more than one year is a YEAR axis — twelve months of a
 * four-year history is a window onto the wrong thing — while a single year pill
 * gets that year's twelve months rather than "the twelve ending now", which for
 * a past season would be twelve empty bars.
 */
export function statsSpark(
  stats: Pick<LogbookStats, "monthly" | "yearly">,
  range: LogbookRange,
  now: Date = new Date(),
): StatsSpark {
  const explicitYear = /^\d{4}$/.test(range.label) ? Number(range.label) : null;
  if (explicitYear != null) {
    return { axis: "month", year: explicitYear, buckets: monthBucketsForYear(stats.monthly, explicitYear, now) };
  }
  if (stats.yearly.length > 1) {
    return { axis: "year", firstYear: stats.yearly[0].year, buckets: yearBuckets(stats.yearly, now) };
  }
  const year = stats.yearly[0]?.year ?? now.getFullYear();
  return { axis: "month", year, buckets: monthBucketsForYear(stats.monthly, year, now) };
}

/**
 * The spark's caption and the cadence lines under it. They ride in the SAME
 * caption block as the spark: they are the day-level reading of the shape above
 * them, and a card around them made three muted sentences look like a fourth
 * statistic.
 */
export function statsCadence(
  stats: LogbookStats,
  activity: string | null,
): { busiest: string | undefined; lines: string[] } {
  const busiest = stats.monthly.reduce(
    (top, entry) => (entry.count > (top?.count ?? 0) ? entry : top),
    null as { year: number; month: number; count: number } | null,
  );
  const lines: string[] = [];
  if (!activity && stats.firstDate) {
    lines.push(`first trip ${formatDateKey(`${stats.firstDate}T00:00:00.000Z`)}`);
  }
  if (stats.averageGapDays != null && stats.longestGapDays != null) {
    lines.push(
      `every ${pluralCount(stats.averageGapDays, "day")} on average · longest gap ${stats.longestGapDays}`,
    );
  }
  lines.push(`${stats.weekendTrips} of ${pluralCount(stats.trips, "trip")} fell on a weekend`);
  if (stats.longestRunDays > 1) {
    lines.push(`longest run ${pluralCount(stats.longestRunDays, "day")} back to back`);
  }
  return {
    busiest: busiest
      ? `busiest ${new Date(Date.UTC(busiest.year, busiest.month, 1)).toLocaleDateString(undefined, {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        })} · ${pluralCount(busiest.count, "trip")}`
      : undefined,
    lines,
  };
}

/**
 * The headline tiles. EVERY LABEL SAYS WHAT IT COUNTS: "Places" could as easily
 * have meant the size of the library, and "Activities" read as a synonym for
 * trips — a tile has no room to explain itself. Over ALL TIME every place was
 * new ground once, so "New places" would restate "Places visited"; "Revisited"
 * is the half of the pair that still says something on an unbounded window.
 */
export function statsHeadline(
  stats: LogbookStats,
  activity: string | null,
  /** A range narrower than "All time" is selected. */
  bounded: boolean,
): { label: string; value: string }[] {
  const ground = bounded
    ? { label: "New places", value: `${stats.newPlaces}` }
    : { label: "Revisited", value: `${stats.repeatPlaces}` };
  return activity
    ? [
        { label: "Trips", value: `${stats.trips}` },
        { label: "Days out", value: `${stats.days}` },
        { label: "Places visited", value: `${stats.places}` },
        ground,
      ]
    : [
        { label: "Trips", value: `${stats.trips}` },
        { label: "Places visited", value: `${stats.places}` },
        { label: "Activity types", value: `${stats.activities}` },
        ground,
      ];
}

export function activityTallySubtitle(tally: ActivityTally): string {
  return tally.places > 0
    ? `${pluralCount(tally.trips, "trip")} · ${pluralCount(tally.places, "place")}`
    : pluralCount(tally.trips, "trip");
}

/** A trip tagged twice counts under both tags, so the activity rows out-sum
 *  the trip tile and read as a bug unless a caption says why. */
export function activityTalliesOverlap(stats: LogbookStats): boolean {
  return stats.activityTallies.reduce((sum, tally) => sum + tally.trips, 0) > stats.trips;
}

export type FieldStatDisplay = {
  /** The number on the row's right edge, with the word that names it. */
  metric?: { value: string; suffix: string };
  subtitle?: string;
  /** A rating's distribution, drawn under the row, and its caption. */
  buckets?: { value: number; count: number }[];
  caption?: string;
};

/**
 * One attribute's stat as a row, chosen by the stat's SHAPE and never by its
 * name. NO TOTALS on a quantity, deliberately: a total is only honest for a
 * quantity a trip SPENDS and nothing in a definition says which ones those are
 * (root CLAUDE.md, "A TOTAL needs a declaration"). An average and a highest are
 * never wrong for either kind. No per-year progression on a rating either: it
 * read as a claim about the user getting better, which a grade distribution
 * over trips does not measure.
 */
export function fieldStatDisplay(stat: FieldStat): FieldStatDisplay {
  switch (stat.kind) {
    case "rating":
      return {
        metric: { value: formatStatNumber(stat.average), suffix: "avg" },
        buckets: stat.buckets,
        caption: stat.best ? `highest ${formatStatNumber(stat.best.value)} · ${stat.best.label}` : undefined,
      };
    case "quantity":
      return {
        metric: { value: formatStatNumber(stat.average), suffix: "avg" },
        subtitle: stat.best ? `highest ${formatStatNumber(stat.best.value)}, ${stat.best.label}` : undefined,
      };
    case "boolean":
      return {
        metric: { value: `${stat.yes}`, suffix: "yes" },
        subtitle: `of ${pluralCount(stat.of, "trip")} answered`,
      };
    case "vocabulary":
      // "×" rather than a space: a value can contain spaces of its own, and
      // "NPWS-2026-114 4" read as part of the identifier.
      return { subtitle: stat.values.map((entry) => `${entry.value} ×${entry.count}`).join(" · ") };
  }
}

// ── One trip's attributes, as a reader sees them ───────────────────────

/** One stored value as a row of a detail page's attribute table: key, label,
 *  value, and the definition's type (null when the definition is gone). */
export type AttributeRow = [key: string, label: string, value: unknown, type: string | null];

/**
 * Every stored value as a row of a detail page's attribute table: the defined
 * ones first, in the definitions' order and under their bare label, then any
 * value whose definition is gone (deleted elsewhere, or not loaded) under its
 * un-slugged key.
 *
 * ONE BUILDER FOR TRIPS AND PLACES, ON BOTH CLIENTS, so no two tables can
 * disagree about what they list. Stored-only, not every definition: listing
 * every attribute ever made, "—" for each one this trip never asked, buried the
 * answers that are there. The bare label rather than `customFieldDisplayLabel`:
 * the "(1-5)" that helps someone typing into a box is noise beside a value
 * already typed. A key defined twice — a shared place labels with the viewer's
 * own definitions AND the owner's snapshot — lists once, under the first.
 */
export function attributeRows(
  // Key, label and type only: a shared place's owner snapshot is typed loosely.
  defs: readonly { key: string; label: string; type?: string }[],
  values: Record<string, unknown> | null | undefined,
): AttributeRow[] {
  const stored = values ?? {};
  const byKey = new Map<string, { label: string; type: string | null }>();
  for (const def of defs) {
    if (!byKey.has(def.key)) byKey.set(def.key, { label: def.label, type: def.type ?? null });
  }
  const defined = [...byKey]
    .filter(([key]) => stored[key] !== undefined)
    .map(([key, { label, type }]): AttributeRow => [key, label, stored[key], type]);
  const orphaned = Object.entries(stored)
    .filter(([key]) => !byKey.has(key))
    .map(([key, value]): AttributeRow => [key, humanizeFieldKey(key), value, null]);
  return [...defined, ...orphaned];
}

/** Keys are slugs of the original label (`makeCustomFieldKey`), so un-slugging
 *  beats showing `water_level` raw. */
export function humanizeFieldKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A stored value as it reads in an attribute table. A date is stored
 *  date-only, so `formatDateKey` reads it in UTC (CH-001). */
export function formatFieldValue(value: unknown, type?: string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (type === "date" && typeof value === "string") return formatDateKey(value);
  return String(value);
}
