import { describe, expect, it } from "vitest";

import {
  activityTalliesOverlap,
  countTripsInLastMonths,
  dateRangeLabel,
  datePresets,
  dateSummary,
  distinctPlaceCount,
  fieldStatDisplay,
  formatTripDate,
  groupTripsByYear,
  logbookActivityLabel,
  logbookRanges,
  monthBucketsForYear,
  monthlyTripCounts,
  statsCadence,
  statsHeadline,
  statsSpark,
  todayDateKey,
  attributeRows,
  formatDateKey,
  formatFieldValue,
  tripYear,
  yearBuckets,
} from "./logbook.js";
import { computeLogbookStats, UNTAGGED_ACTIVITY } from "./logbookStats.js";
import type { TripLogCustomFieldDef } from "./tripLogFields.js";

/** UTC midnight of a "YYYY-MM-DD" key — the instant the API stores. */
const fromDateKey = (key: string) => new Date(`${key}T00:00:00.000Z`);

describe("date handling", () => {
  it("reads a UTC-midnight date as its own calendar day", () => {
    // The CH-001 trap: in AEST, a local-time read of this instant is 14 March.
    expect(tripYear("2026-01-01T00:00:00.000Z")).toBe(2026);
    expect(formatTripDate("2026-03-15T00:00:00.000Z")).toContain("15");
    expect(formatTripDate("2026-03-15T00:00:00.000Z")).toContain("2026");
  });
});

describe("dateRangeLabel", () => {
  it("says an open bound in words", () => {
    expect(dateRangeLabel(null, null)).toBe("Any time → Today");
    expect(dateRangeLabel("2026-01-01", null)).toMatch(/2026 → Today$/);
  });
});

describe("groupTripsByYear", () => {
  it("groups newest year first and keeps input order within a year", () => {
    const trips = [
      { date: "2026-05-01T00:00:00.000Z", id: "a" },
      { date: "2026-01-02T00:00:00.000Z", id: "b" },
      { date: "2024-11-30T00:00:00.000Z", id: "c" },
      { date: "2025-06-01T00:00:00.000Z", id: "d" },
    ];
    expect(groupTripsByYear(trips)).toEqual([
      { year: 2026, trips: [trips[0], trips[1]] },
      { year: 2025, trips: [trips[3]] },
      { year: 2024, trips: [trips[2]] },
    ]);
  });

  it("is empty for no trips", () => {
    expect(groupTripsByYear([])).toEqual([]);
  });

  it("puts a 1 January trip in its own year, not the previous one", () => {
    expect(groupTripsByYear([{ date: "2026-01-01T00:00:00.000Z" }])[0].year).toBe(2026);
  });
});

describe("distinctPlaceCount", () => {
  it("counts a place done twice once", () => {
    const trips = [
      { date: "2026-01-01T00:00:00.000Z", places: [{ id: "x", name: "X" }] },
      {
        date: "2026-02-01T00:00:00.000Z",
        places: [
          { id: "x", name: "X" },
          { id: "y", name: "Y" },
        ],
      },
      { date: "2026-03-01T00:00:00.000Z", places: [] },
    ];
    expect(distinctPlaceCount(trips)).toBe(2);
  });
});

describe("monthlyTripCounts", () => {
  const now = new Date("2026-07-25T10:00:00.000Z");

  it("returns one bucket per month ending with the current one", () => {
    const buckets = monthlyTripCounts([], now);
    expect(buckets).toHaveLength(12);
    expect(buckets[11].current).toBe(true);
    expect(buckets.filter((bucket) => bucket.current)).toHaveLength(1);
    // Aug 2025 → Jul 2026.
    expect(buckets[0].label).toBe("A");
    expect(buckets[11].label).toBe("J");
  });

  it("tallies trips into their month and ignores older ones", () => {
    const buckets = monthlyTripCounts(
      [
        { date: "2026-07-04T00:00:00.000Z" },
        { date: "2026-07-20T00:00:00.000Z" },
        { date: "2026-03-15T00:00:00.000Z" },
        { date: "2019-01-01T00:00:00.000Z" },
      ],
      now,
    );
    expect(buckets[11].count).toBe(2);
    expect(buckets[7].count).toBe(1);
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3);
  });

  it("crosses the year boundary backwards", () => {
    const buckets = monthlyTripCounts([{ date: "2025-08-02T00:00:00.000Z" }], now);
    expect(buckets[0].count).toBe(1);
  });
});

describe("countTripsInLastMonths", () => {
  const now = new Date("2026-07-25T10:00:00.000Z");

  it("counts from the first day of the earliest bucket", () => {
    const trips = [
      { date: "2025-08-01T00:00:00.000Z" },
      { date: "2025-07-31T00:00:00.000Z" },
      { date: "2026-07-25T00:00:00.000Z" },
    ];
    expect(countTripsInLastMonths(trips, now)).toBe(2);
  });

  it("agrees with the spark's own total", () => {
    const trips = [
      { date: "2025-08-01T00:00:00.000Z" },
      { date: "2025-07-31T00:00:00.000Z" },
      { date: "2026-02-14T00:00:00.000Z" },
    ];
    const sparkTotal = monthlyTripCounts(trips, now).reduce(
      (sum, bucket) => sum + bucket.count,
      0,
    );
    expect(countTripsInLastMonths(trips, now)).toBe(sparkTotal);
  });
});

// ── the "now" convention, pinned OUTSIDE UTC ─────────────────────────────────
//
// Every other test here runs in the dev host's timezone, which for this project
// is the users' timezone too — so a bug that only shows east of Greenwich is
// invisible in all of them. These run the same maths under a fixed non-UTC zone
// at the hour of day where local and UTC disagree about the calendar month.
function inTimeZone<T>(timeZone: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return run();
  } finally {
    process.env.TZ = previous;
  }
}

describe("todayDateKey", () => {
  it("is the LOCAL calendar day, not the UTC one", () => {
    // 07:00 on 15 March in Sydney is still 14 March in UTC.
    inTimeZone("Australia/Sydney", () => {
      expect(todayDateKey(new Date("2026-03-14T20:00:00.000Z"))).toBe("2026-03-15");
    });
  });
});

describe("the current-month bucket in a non-UTC timezone", () => {
  // 00:30 on 1 August in Sydney (UTC+10) — still 31 July in UTC. The whole of
  // the local 1st sits in the previous UTC month, and around 40% of every other
  // local day sits in the previous UTC day.
  const earlyOnTheFirst = new Date("2026-07-31T14:30:00.000Z");

  it("buckets a trip logged 'today' into the month the user is in", () => {
    inTimeZone("Australia/Sydney", () => {
      // Exactly what both trip forms store for "today".
      const storedToday = fromDateKey(todayDateKey(earlyOnTheFirst));
      expect(storedToday.toISOString()).toBe("2026-08-01T00:00:00.000Z");

      const trips = [{ date: storedToday.toISOString() }];
      const buckets = monthlyTripCounts(trips, earlyOnTheFirst);
      expect(buckets[11]).toMatchObject({ label: "A", current: true, count: 1 });
      // Reading `now` in UTC put the last bucket on July and dropped the trip
      // out of the window entirely.
      expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(1);
      expect(countTripsInLastMonths(trips, earlyOnTheFirst)).toBe(1);
    });
  });

  it("starts the window on the first of the local month, 11 months back", () => {
    inTimeZone("Australia/Sydney", () => {
      const trips = [
        { date: "2025-09-01T00:00:00.000Z" },
        { date: "2025-08-31T00:00:00.000Z" },
      ];
      // Window is Sep 2025 → Aug 2026, so only the first trip is in it.
      expect(countTripsInLastMonths(trips, earlyOnTheFirst)).toBe(1);
      expect(monthlyTripCounts(trips, earlyOnTheFirst)[0]).toMatchObject({
        label: "S",
        count: 1,
      });
    });
  });

  it("agrees with itself west of Greenwich too", () => {
    // 23:30 on 31 July in Los Angeles is already 1 August in UTC — the mirror
    // image, and the reason the fix is "read `now` locally", not "subtract 10h".
    const lateOnTheLast = new Date("2026-08-01T06:30:00.000Z");
    inTimeZone("America/Los_Angeles", () => {
      const storedToday = fromDateKey(todayDateKey(lateOnTheLast));
      expect(storedToday.toISOString()).toBe("2026-07-31T00:00:00.000Z");
      const buckets = monthlyTripCounts([{ date: storedToday.toISOString() }], lateOnTheLast);
      expect(buckets[11]).toMatchObject({ label: "J", current: true, count: 1 });
    });
  });
});

describe("logbookRanges", () => {
  it("leads with all time and the relative presets", () => {
    expect(logbookRanges([], "2026-09-13").slice(0, 4).map((r) => r.label)).toEqual([
      "All time",
      "This year",
      "Last 12 months",
      "2025",
    ]);
  });

  it("adds a pill per earlier year the user has trips in, newest first", () => {
    expect(
      logbookRanges([2022, 2024, 2024, 2023], "2026-09-13").map((r) => r.label),
    ).toEqual(["All time", "This year", "Last 12 months", "2025", "2024", "2023", "2022"]);
  });

  it("never repeats a year the presets already cover", () => {
    const labels = logbookRanges([2026, 2025], "2026-09-13").map((r) => r.label);
    expect(labels.filter((label) => label === "2025")).toHaveLength(1);
    expect(labels).not.toContain("2026");
  });

  it("bounds a year pill to that calendar year", () => {
    expect(logbookRanges([2023], "2026-09-13").at(-1)).toEqual({
      label: "2023",
      from: "2023-01-01",
      to: "2023-12-31",
    });
  });

  it("shares its relative presets with the Logs date filter", () => {
    const ranges = logbookRanges([], "2026-09-13");
    for (const preset of datePresets("2026-09-13")) {
      expect(ranges).toContainEqual(preset);
    }
  });
});

describe("stats spark buckets", () => {
  it("draws twelve months for one year, whatever months have trips", () => {
    const buckets = monthBucketsForYear(
      [
        { year: 2025, month: 2, count: 3 },
        { year: 2026, month: 2, count: 9 },
      ],
      2025,
      new Date("2026-09-13T00:00:00.000Z"),
    );
    expect(buckets).toHaveLength(12);
    expect(buckets[2]).toMatchObject({ count: 3, current: false });
    // A past year has no "you are here" bucket.
    expect(buckets.some((bucket) => bucket.current)).toBe(false);
  });

  it("marks the current month of the current year", () => {
    inTimeZone("Australia/Sydney", () => {
      const buckets = monthBucketsForYear([], 2026, new Date("2026-09-13T00:00:00.000Z"));
      expect(buckets.filter((bucket) => bucket.current)).toHaveLength(1);
      expect(buckets[8].current).toBe(true);
    });
  });

  it("keeps an empty year in the year axis rather than closing the gap", () => {
    expect(
      yearBuckets(
        [
          { year: 2023, count: 2 },
          { year: 2026, count: 5 },
        ],
        new Date("2026-09-13T00:00:00.000Z"),
      ),
    ).toEqual([
      { label: "23", count: 2, current: false },
      { label: "24", count: 0, current: false },
      { label: "25", count: 0, current: false },
      { label: "26", count: 5, current: true },
    ]);
  });

  it("has no year axis with no trips", () => {
    expect(yearBuckets([])).toEqual([]);
  });
});

describe("stats presentation", () => {
  const base = computeLogbookStats({
    trips: [
      { id: "1", date: "2024-03-02T00:00:00.000Z", types: ["canyoning"], places: [{ id: "p", name: "Claustral" }], customFields: {} },
      { id: "2", date: "2026-03-07T00:00:00.000Z", types: ["canyoning", "abseil course"], places: [{ id: "p", name: "Claustral" }], customFields: {} },
      { id: "3", date: "2026-03-08T00:00:00.000Z", types: [], places: [], customFields: {} },
    ],
    places: [{ id: "p", name: "Claustral", placeTypeId: "t", fieldValues: {} }],
    tripDefs: [],
    placeDefs: [],
    placeTypes: [{ id: "t", name: "Canyon", color: "#000000" }],
  });
  const allTime = { label: "All time", from: null, to: null };

  it("draws years for a multi-year all-time range, and a year pill's months", () => {
    expect(statsSpark(base, allTime).axis).toBe("year");
    const pill = statsSpark(base, { label: "2024", from: "2024-01-01", to: "2024-12-31" });
    expect(pill).toMatchObject({ axis: "month", year: 2024 });
    expect(pill.buckets).toHaveLength(12);
  });

  it("names the busiest month and states the cadence in words", () => {
    const { busiest, lines } = statsCadence(base, null);
    expect(busiest).toMatch(/^busiest .*2026 · 2 trips$/);
    expect(lines[0]).toMatch(/^first trip /);
    // 2 Mar 2024, 7 Mar 2026 and 8 Mar 2026: a Saturday, a Saturday, a Sunday.
    expect(lines).toContain("3 of 3 trips fell on a weekend");
    expect(lines).toContain("longest run 2 days back to back");
  });

  it("swaps New places for Revisited on an unbounded range", () => {
    expect(statsHeadline(base, null, false).map((tile) => tile.label)).toEqual([
      "Trips",
      "Places visited",
      "Activity types",
      "Revisited",
    ]);
    expect(statsHeadline(base, "canyoning", true).at(-1)).toEqual({ label: "New places", value: "1" });
  });

  it("files a tag-less trip under Untagged, and flags double-counted tags", () => {
    expect(logbookActivityLabel(UNTAGGED_ACTIVITY)).toBe("Untagged");
    expect(logbookActivityLabel("canyoning")).toBe("Canyoning");
    expect(activityTalliesOverlap(base)).toBe(true);
  });

  it("gives a quantity an average and a highest, never a total", () => {
    const display = fieldStatDisplay({
      kind: "quantity",
      key: "pitches",
      label: "Pitches",
      total: 30,
      average: 7.5,
      best: { value: 12, label: "Claustral" },
    });
    expect(display).toEqual({ metric: { value: "7.5", suffix: "avg" }, subtitle: "highest 12, Claustral" });
  });

  it("counts a vocabulary with ×, so a spaced value stays one value", () => {
    expect(
      fieldStatDisplay({ kind: "vocabulary", key: "k", label: "Permit", values: [{ value: "NPWS 114", count: 4 }] }),
    ).toEqual({ subtitle: "NPWS 114 ×4" });
  });
});

describe("attributeRows", () => {
  const capacity: TripLogCustomFieldDef = { key: "capacity", label: "Capacity", type: "integer", min: 1, max: 5 };
  const isCave: TripLogCustomFieldDef = { key: "is_cave", label: "Is a cave?", type: "boolean" };
  const permit: TripLogCustomFieldDef = { key: "permit", label: "Permit", type: "string" };

  it("lists defined values in definition order under the bare label, then orphans", () => {
    expect(attributeRows([capacity, isCave, permit], { water_level: "low", is_cave: false, capacity: 3 })).toEqual([
      ["capacity", "Capacity", 3, "integer"],
      ["is_cave", "Is a cave?", false, "boolean"],
      ["water_level", "Water level", "low", null],
    ]);
  });

  // A shared place labels with the viewer's definitions AND the owner's
  // snapshot, and a key both carry must not print twice.
  it("lists a key defined twice once, under the first label", () => {
    expect(attributeRows([permit, { ...permit, label: "Owner's permit" }], { permit: "NP-1" })).toEqual([
      ["permit", "Permit", "NP-1", "string"],
    ]);
  });

  it("keeps a stored null, which is an answer the form wrote", () => {
    expect(attributeRows([permit], { permit: null })).toHaveLength(1);
  });

  it("is empty for nothing stored", () => {
    expect(attributeRows([permit], null)).toEqual([]);
  });
});

describe("formatFieldValue", () => {
  it("reads empty as —, a yes/no as Yes/No, and a date in UTC", () => {
    expect(formatFieldValue(null)).toBe("—");
    expect(formatFieldValue("")).toBe("—");
    expect(formatFieldValue(false, "boolean")).toBe("No");
    expect(formatFieldValue("2026-03-01T00:00:00.000Z", "date")).toBe(formatDateKey("2026-03-01T00:00:00.000Z"));
    expect(formatFieldValue("2026-03-01T00:00:00.000Z", "string")).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("dateSummary", () => {
  // A collapsed filter field has to state that it is NOT filtering, which is
  // what separates this from dateRangeLabel's "Any time → Today".
  it("says Any when nothing is set", () => {
    expect(dateSummary(null)).toBe("Any");
    expect(dateSummary([null, null])).toBe("Any");
  });

  it("names both bounds when both are set", () => {
    expect(dateSummary(["2026-01-01", "2026-03-31"])).toBe("2026-01-01 – 2026-03-31");
  });

  it("names the open end when only one is set", () => {
    expect(dateSummary(["2026-01-01", null])).toBe("From 2026-01-01");
    expect(dateSummary([null, "2026-03-31"])).toBe("To 2026-03-31");
  });
});
