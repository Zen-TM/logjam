// THE LOGBOOK STATS DERIVATION — one pure pass over a user's trips, shared by
// the phone (SQLite mirror) and the API (Prisma rows).
//
// It lives here rather than in either client for the reason every other
// two-surface rule in this repo does: "how many trips have I done" must not be
// able to come out differently on a phone and in a browser. The inputs are
// plain shapes, deliberately not Prisma or mirror types, so each caller maps
// its own rows in and nothing here knows about a database.
//
// WHAT THIS SCREEN IS ABOUT, because it decides every rule below: a user's
// TRIPS — what they have done — and not their library. "How many pitches do my
// forty canyons hold between them" is a question about an inventory and nobody
// asks it; "how many did I abseil" is the journey. So a place attribute is read
// ONCE PER TRIP THAT LINKED THE PLACE, not once per place. Doing a canyon three
// times counts its pitches three times, which is the whole point.
//
// DATES ARE UTC. Trip dates are UTC-midnight date-only values (CH-001), so
// every bucket, gap and weekday here reads UTC fields. A `now`-style instant
// never enters this module — the caller resolves the range to date keys first
// (mobile/src/ui/monthGrid.ts has the local-vs-UTC rules for that conversion).

import {
  defsForType,
  tripFieldDefs,
  type ScopedCustomFieldDef,
} from "./tripLogFields.js";
import { asFieldValues } from "./fieldValues.js";

// ── Inputs ─────────────────────────────────────────────────────────────

export type StatsTrip = {
  id: string;
  /** UTC-midnight ISO instant, as stored. */
  date: string;
  types: string[];
  places: { id: string; name: string }[];
  customFields: unknown;
};

export type StatsPlace = {
  id: string;
  name: string;
  placeTypeId: string;
  fieldValues: unknown;
};

export type StatsPlaceType = {
  id: string;
  name: string;
  color: string;
};

export type StatsInput = {
  trips: StatsTrip[];
  places: StatsPlace[];
  /** Definitions with `entity === "tripLog"`. */
  tripDefs: ScopedCustomFieldDef[];
  /** Definitions with `entity === "place"`. */
  placeDefs: ScopedCustomFieldDef[];
  placeTypes: StatsPlaceType[];
  /** Inclusive "YYYY-MM-DD" bounds; null means open. */
  from?: string | null;
  to?: string | null;
  /** One trip type ("canyoning"), `UNTAGGED` for trips with no type at all, or
   *  null for every trip — the All screen. */
  activity?: string | null;
};

/** The activity key for trips carrying no type. Not a real tag: a user could
 *  type "untagged" as one, which is why this is a symbol-ish sentinel string
 *  that `makeCustomFieldKey`-style input can never produce. */
export const UNTAGGED_ACTIVITY = "\u0000untagged";

// ── Outputs ────────────────────────────────────────────────────────────

/**
 * A number that is BOUNDED on both sides with a small span is a rating — a
 * grade, a star score — and the interesting thing about a rating is its
 * distribution and whether it is climbing. An unbounded one is a quantity —
 * pitches, hours, metres — and the interesting thing is the total.
 *
 * That is the whole of the rule, and it needs no extra flag on a definition
 * because the field editor already forces the distinction: you bound a rating
 * (1-7) and you leave a count open ("how many" has no honest ceiling — see the
 * `min`-only comment on `TripLogCustomFieldDef`). The span cap is what stops
 * someone who bounded "pitches" 0-100 getting a hundred-bar chart; a field like
 * that falls through to the quantity arm, which is the right read anyway.
 */
export const RATING_MAX_SPAN = 12;

/** A string field with few enough distinct answers is a vocabulary the user
 *  keeps re-typing ("high"/"medium"/"low"), and counting those is useful. Above
 *  this it is free prose and a frequency list is noise. */
export const VOCABULARY_MAX_DISTINCT = 8;

/**
 * ...and a vocabulary TERM is short. Cardinality alone is not enough: a place
 * attribute like "Access beta" holds a paragraph, and four trips to the same
 * canyon repeat that paragraph four times — three distinct values, through the
 * cardinality gate, and rendered as a tally of prose. A term someone re-types
 * is a word or two.
 */
export const VOCABULARY_MAX_TERM_LENGTH = 24;

export type FieldStat = { label: string; key: string } & (
  | {
      kind: "rating";
      /** One entry per integer step from min to max, including empty ones —
       *  the gaps are the shape. */
      buckets: { value: number; count: number }[];
      average: number;
      best: { value: number; label: string } | null;
    }
  | {
      kind: "quantity";
      /**
       * The trip-weighted sum. NOT RENDERED by any client today, deliberately:
       * a total is only meaningful for a quantity a trip SPENDS, and nothing in
       * a definition says which ones those are — summing a place property gives
       * "1996 longest pitch", summing a trip property gives "1530 rope length".
       * It stays because it is what the per-trip weighting is actually proved
       * by (see the "weights a place attribute PER TRIP" case), and because it
       * is the number an "adds up each trip" flag would switch on.
       */
      total: number;
      average: number;
      best: { value: number; label: string } | null;
    }
  | { kind: "boolean"; yes: number; of: number }
  | { kind: "vocabulary"; values: { value: string; count: number }[] }
);

export type ActivityTally = {
  /** The stored tag, or `UNTAGGED_ACTIVITY`. */
  type: string;
  trips: number;
  places: number;
};

export type LogbookStats = {
  trips: number;
  /** Distinct calendar days — two trips on one day is one day out. */
  days: number;
  /** Distinct places linked by trips in range. */
  places: number;
  activities: number;
  /** Date keys of the first and last trip in range, or null when there are none. */
  firstDate: string | null;
  lastDate: string | null;
  /** Mean days between consecutive days out. Null under two days out. */
  averageGapDays: number | null;
  /** The longest silence between two days out. Null under two days out. */
  longestGapDays: number | null;
  /** Consecutive days out — a multi-day trip, which no per-trip count shows. */
  longestRunDays: number;
  /** Trips falling on a Saturday or Sunday (UTC, per CH-001). */
  weekendTrips: number;
  monthly: { year: number; month: number; count: number }[];
  yearly: { year: number; count: number }[];
  activityTallies: ActivityTally[];
  /** Places whose FIRST EVER visit falls in range — new ground, as opposed to
   *  a return. Computed against every trip, not just the ones in range, or the
   *  answer would be "all of them" for any narrow window. */
  newPlaces: number;
  /** Places visited more than once in range. The counterpart to `newPlaces`,
   *  and the one of the pair that still says something over ALL TIME — every
   *  place was new ground once, so that tile is a tautology on an unbounded
   *  window while this one is not. */
  repeatPlaces: number;
  mostReturned: { name: string; trips: number } | null;
  /** One entry per place type the user has any place of. */
  completion: {
    typeId: string;
    name: string;
    color: string;
    total: number;
    logged: number;
  }[];
  /**
   * The user's own trip-level attributes — one answer per trip.
   *
   * WHICH ONES depends on the scope, for the same reason place attributes wait
   * for a drill-down. On the All screen: only the attributes EVERY trip is
   * asked (`appliesToAllTypes`) — a "river level" scoped to packrafting pooled
   * with a canyoning answer to the same question would be one figure over two
   * distributions. On an activity's screen: the attributes that activity asks,
   * summarised over its own trips, plus any attribute those trips hold a value
   * for — the same rule the trip form uses (`tripFieldDefs`), so every recorded
   * value is counted on some screen.
   */
  tripFieldStats: FieldStat[];
  /** On the All screen, how many activity-scoped attributes hold a value in
   *  range and so appear only under their activities — what the screen needs
   *  to say they have not gone missing. Always 0 on an activity's screen. */
  tripFieldsUnderActivities: number;
  /**
   * Place attributes, GROUPED BY THE TYPE OF PLACE THEY BELONG TO, most-visited
   * type first.
   *
   * One flat list put a campsite's "Capacity" directly under a canyon's
   * "Longest pitch", which is confusing but not wrong — a canyoning trip that
   * also stopped at a campsite legitimately carries both. The type is the
   * vocabulary that explains it, so the type does the grouping.
   *
   * A definition scoped to two types (Quality covers canyons AND campsites)
   * appears under EACH, summarised over only that type's samples — which is
   * more correct than one merged figure rather than just tidier: the quality of
   * the canyons someone does and the quality of the campsites they stay at are
   * two different distributions.
   */
  placeFieldStats: {
    typeId: string;
    name: string;
    color: string;
    stats: FieldStat[];
  }[];
};

// ── Derivation ─────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" of a stored trip date, read in UTC. */
export function tripDateKey(isoDate: string): string {
  return new Date(isoDate).toISOString().slice(0, 10);
}

function inRange(key: string, from?: string | null, to?: string | null): boolean {
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

function tripMatchesActivity(trip: StatsTrip, activity: string | null): boolean {
  if (!activity) return true;
  if (activity === UNTAGGED_ACTIVITY) return trip.types.length === 0;
  return trip.types.some((type) => type.toLowerCase() === activity.toLowerCase());
}

type FieldSample = { value: unknown; label: string };

/**
 * Whichever of the two readings a definition supports, summarised. Returns null
 * where there is nothing worth drawing — no samples, or a type with no useful
 * aggregate (a date, a free-prose string).
 */
function summarizeField(
  def: ScopedCustomFieldDef,
  samples: FieldSample[],
): FieldStat | null {
  if (samples.length === 0) return null;
  const head = { label: def.label, key: def.key };

  if (def.type === "boolean") {
    const booleans = samples.filter((s) => typeof s.value === "boolean");
    if (booleans.length === 0) return null;
    return {
      ...head,
      kind: "boolean",
      yes: booleans.filter((s) => s.value === true).length,
      of: booleans.length,
    };
  }

  if (def.type === "string") {
    const strings = samples
      .map((s) => (typeof s.value === "string" ? s.value.trim() : ""))
      .filter((value) => value.length > 0);
    if (strings.length === 0) return null;
    if (strings.some((value) => value.length > VOCABULARY_MAX_TERM_LENGTH)) {
      return null;
    }
    const counts = new Map<string, number>();
    for (const value of strings) {
      // Case-folded for counting, but the FIRST spelling the user typed is what
      // is shown — "High" and "high" are one answer, not two.
      const existing = [...counts.keys()].find(
        (seen) => seen.toLowerCase() === value.toLowerCase(),
      );
      const bucket = existing ?? value;
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    if (counts.size > VOCABULARY_MAX_DISTINCT) return null;
    // A single value repeated is a CONSTANT, not a distribution — there is
    // nothing to compare it against. Four trips to one canyon made its permit
    // number look like a vocabulary with one entry; a tally of one says less
    // than no tally at all.
    if (counts.size < 2) return null;
    return {
      ...head,
      kind: "vocabulary",
      values: [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    };
  }

  if (def.type !== "integer" && def.type !== "float") return null;

  const numbers = samples.filter(
    (s): s is FieldSample & { value: number } =>
      typeof s.value === "number" && Number.isFinite(s.value),
  );
  if (numbers.length === 0) return null;

  const total = numbers.reduce((sum, s) => sum + s.value, 0);
  const average = total / numbers.length;
  const best = numbers.reduce((top, s) => (s.value > top.value ? s : top));
  const bestOut = { value: best.value, label: best.label };

  const bounded =
    def.min != null && def.max != null && def.max - def.min <= RATING_MAX_SPAN;
  if (!bounded) {
    return { ...head, kind: "quantity", total, average, best: bestOut };
  }

  const min = Math.floor(def.min as number);
  const max = Math.ceil(def.max as number);
  const buckets: { value: number; count: number }[] = [];
  for (let value = min; value <= max; value += 1) {
    buckets.push({
      value,
      // A float rating lands in the nearest whole step; a 3.5 quality is drawn
      // on 4 rather than dropped for not being an integer.
      count: numbers.filter((s) => Math.round(s.value) === value).length,
    });
  }

  return { ...head, kind: "rating", buckets, average, best: bestOut };
}

export function computeLogbookStats(input: StatsInput): LogbookStats {
  const { trips, places, tripDefs, placeDefs, placeTypes } = input;
  const activity = input.activity ?? null;
  const placeById = new Map(places.map((place) => [place.id, place]));

  // EVERY trip, before any filter — `newPlaces` asks whether a visit was the
  // first ever, which a range-filtered set cannot answer.
  const firstVisitByPlace = new Map<string, string>();
  for (const trip of trips) {
    const key = tripDateKey(trip.date);
    for (const link of trip.places) {
      const seen = firstVisitByPlace.get(link.id);
      if (!seen || key < seen) firstVisitByPlace.set(link.id, key);
    }
  }

  const selected = trips
    .filter((trip) => inRange(tripDateKey(trip.date), input.from, input.to))
    .filter((trip) => tripMatchesActivity(trip, activity));

  const dayKeys = [...new Set(selected.map((trip) => tripDateKey(trip.date)))].sort();
  const placeIds = new Set(selected.flatMap((trip) => trip.places.map((p) => p.id)));

  // Cadence. One pass over the distinct days, ascending.
  let longestGapDays: number | null = null;
  let longestRunDays = dayKeys.length > 0 ? 1 : 0;
  let run = longestRunDays;
  for (let index = 1; index < dayKeys.length; index += 1) {
    const gap = Math.round(
      (Date.parse(`${dayKeys[index]}T00:00:00Z`) -
        Date.parse(`${dayKeys[index - 1]}T00:00:00Z`)) /
        DAY_MS,
    );
    longestGapDays = Math.max(longestGapDays ?? 0, gap);
    run = gap === 1 ? run + 1 : 1;
    longestRunDays = Math.max(longestRunDays, run);
  }
  const averageGapDays =
    dayKeys.length >= 2 && longestGapDays != null
      ? Math.round(
          (Date.parse(`${dayKeys[dayKeys.length - 1]}T00:00:00Z`) -
            Date.parse(`${dayKeys[0]}T00:00:00Z`)) /
            DAY_MS /
            (dayKeys.length - 1),
        )
      : null;

  const weekendTrips = selected.filter((trip) => {
    const day = new Date(`${tripDateKey(trip.date)}T00:00:00Z`).getUTCDay();
    return day === 0 || day === 6;
  }).length;

  // Buckets. Months for a narrow range, years for a wide one — the caller picks
  // which it draws, so both are computed here rather than guessed at.
  const monthlyMap = new Map<string, number>();
  const yearlyMap = new Map<number, number>();
  for (const trip of selected) {
    const date = new Date(trip.date);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    monthlyMap.set(`${year}-${month}`, (monthlyMap.get(`${year}-${month}`) ?? 0) + 1);
    yearlyMap.set(year, (yearlyMap.get(year) ?? 0) + 1);
  }
  const monthly = [...monthlyMap.entries()]
    .map(([key, count]) => {
      const [year, month] = key.split("-").map(Number);
      return { year, month, count };
    })
    .sort((a, b) => a.year - b.year || a.month - b.month);
  const yearly = [...yearlyMap.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year);

  // Activity tallies come from the RANGE-filtered but NOT activity-filtered
  // set: the All screen is the only reader, and a list of one row would be a
  // strange thing to show on a screen already scoped to that one activity.
  const inRangeTrips = trips.filter((trip) =>
    inRange(tripDateKey(trip.date), input.from, input.to),
  );
  const tallyMap = new Map<string, { trips: number; places: Set<string> }>();
  for (const trip of inRangeTrips) {
    const keys = trip.types.length > 0 ? trip.types : [UNTAGGED_ACTIVITY];
    for (const key of keys) {
      const tally = tallyMap.get(key) ?? { trips: 0, places: new Set<string>() };
      tally.trips += 1;
      for (const link of trip.places) tally.places.add(link.id);
      tallyMap.set(key, tally);
    }
  }
  const activityTallies = [...tallyMap.entries()]
    .map(([type, tally]) => ({ type, trips: tally.trips, places: tally.places.size }))
    // Untagged sorts last whatever its count: it is the absence of an answer,
    // not the most popular activity.
    .sort((a, b) => {
      if (a.type === UNTAGGED_ACTIVITY) return 1;
      if (b.type === UNTAGGED_ACTIVITY) return -1;
      return b.trips - a.trips || a.type.localeCompare(b.type);
    });

  const newPlaces = [...placeIds].filter((id) => {
    const first = firstVisitByPlace.get(id);
    return first != null && inRange(first, input.from, input.to);
  }).length;

  const visitCounts = new Map<string, { name: string; trips: number }>();
  for (const trip of selected) {
    for (const link of trip.places) {
      const entry = visitCounts.get(link.id) ?? {
        name: placeById.get(link.id)?.name ?? link.name,
        trips: 0,
      };
      entry.trips += 1;
      visitCounts.set(link.id, entry);
    }
  }
  const mostReturned =
    [...visitCounts.values()].sort((a, b) => b.trips - a.trips)[0] ?? null;
  const repeatPlaces = [...visitCounts.values()].filter(
    (entry) => entry.trips > 1,
  ).length;

  const completion = placeTypes
    .map((type) => {
      const ofType = places.filter((place) => place.placeTypeId === type.id);
      return {
        typeId: type.id,
        name: type.name,
        color: type.color,
        total: ofType.length,
        logged: ofType.filter((place) => placeIds.has(place.id)).length,
      };
    })
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.logged - a.logged || b.total - a.total);

  // ── Field stats ──
  // Two sample sources, one summariser. A TRIP field is answered once per trip;
  // a PLACE field is answered once per linked place per trip, which is the
  // trip-weighting the whole module is built around.
  const tripSamplesByKey = new Map<string, FieldSample[]>();
  // Keyed by `${placeTypeId}\u0000${fieldKey}`: a field scoped to two types is
  // two distributions, not one pooled figure.
  const placeSamplesByTypeKey = new Map<string, FieldSample[]>();
  const visitsByTypeId = new Map<string, number>();
  const tripValueKeys = new Set<string>();

  for (const trip of selected) {
    const label = trip.places[0]?.name ?? tripDateKey(trip.date);
    const values = asFieldValues(trip.customFields);
    for (const [key, value] of Object.entries(values)) {
      if (value == null) continue;
      tripValueKeys.add(key);
      const bucket = tripSamplesByKey.get(key) ?? [];
      bucket.push({ value, label });
      tripSamplesByKey.set(key, bucket);
    }
    for (const link of trip.places) {
      const place = placeById.get(link.id);
      if (!place) continue;
      visitsByTypeId.set(
        place.placeTypeId,
        (visitsByTypeId.get(place.placeTypeId) ?? 0) + 1,
      );
      const placeValues = asFieldValues(place.fieldValues);
      for (const [key, value] of Object.entries(placeValues)) {
        if (value == null) continue;
        const sampleKey = `${place.placeTypeId}\u0000${key}`;
        const bucket = placeSamplesByTypeKey.get(sampleKey) ?? [];
        bucket.push({ value, label: place.name });
        placeSamplesByTypeKey.set(sampleKey, bucket);
      }
    }
  }

  // WHICH definitions get asked — see `tripFieldStats` on the output type. On
  // a drill-down the union clause is `tripFieldDefs`'s own and for the same
  // reason: a value typed under a definition since rescoped, or on a trip since
  // retagged, must still be counted, or the screen quietly disagrees with the
  // trip it came from.
  const askedTripDefs =
    activity == null
      ? tripDefs.filter((def) => def.appliesToAllTypes)
      : tripFieldDefs(
          tripDefs,
          activity === UNTAGGED_ACTIVITY ? [] : [activity],
          null,
          tripValueKeys,
        );
  const tripFieldStats = askedTripDefs
    .map((def) => summarizeField(def, tripSamplesByKey.get(def.key) ?? []))
    .filter((stat): stat is FieldStat => stat != null);
  const tripFieldsUnderActivities =
    activity == null
      ? tripDefs.filter(
          (def) => !def.appliesToAllTypes && tripValueKeys.has(def.key),
        ).length
      : 0;

  const placeFieldStats = [...visitsByTypeId.entries()]
    // Most-visited type first: on a canyoning trip the canyons are the subject
    // and the campsite is the aside, and the order should say so.
    .sort((a, b) => b[1] - a[1])
    .map(([typeId]) => {
      const type = placeTypes.find((entry) => entry.id === typeId);
      return {
        typeId,
        name: type?.name ?? "Places",
        color: type?.color ?? "",
        stats: defsForType(placeDefs, typeId)
          .map((def) =>
            summarizeField(
              def,
              placeSamplesByTypeKey.get(`${typeId}\u0000${def.key}`) ?? [],
            ),
          )
          .filter((stat): stat is FieldStat => stat != null),
      };
    })
    .filter((group) => group.stats.length > 0);

  return {
    trips: selected.length,
    days: dayKeys.length,
    places: placeIds.size,
    activities: activityTallies.filter((tally) => tally.type !== UNTAGGED_ACTIVITY)
      .length,
    firstDate: dayKeys[0] ?? null,
    lastDate: dayKeys[dayKeys.length - 1] ?? null,
    averageGapDays,
    longestGapDays,
    longestRunDays,
    weekendTrips,
    monthly,
    yearly,
    activityTallies,
    newPlaces,
    repeatPlaces,
    mostReturned: mostReturned && mostReturned.trips > 1 ? mostReturned : null,
    completion,
    tripFieldStats,
    tripFieldsUnderActivities,
    placeFieldStats,
  };
}
