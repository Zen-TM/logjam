import { describe, expect, it } from "vitest";

import {
  countTripsInLastMonths,
  distinctCanyonCount,
  formatTripDate,
  groupTripsByYear,
  monthlyTripCounts,
  tripYear,
} from "./logbook";

import { fromDateKey, todayDateKey } from "../ui/monthGrid";

describe("date handling", () => {
  it("reads a UTC-midnight date as its own calendar day", () => {
    // The CH-001 trap: in AEST, a local-time read of this instant is 14 March.
    expect(tripYear("2026-01-01T00:00:00.000Z")).toBe(2026);
    expect(formatTripDate("2026-03-15T00:00:00.000Z")).toContain("15");
    expect(formatTripDate("2026-03-15T00:00:00.000Z")).toContain("2026");
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

describe("distinctCanyonCount", () => {
  it("counts a canyon done twice once", () => {
    const trips = [
      { date: "2026-01-01T00:00:00.000Z", canyons: [{ id: "x", name: "X" }] },
      {
        date: "2026-02-01T00:00:00.000Z",
        canyons: [
          { id: "x", name: "X" },
          { id: "y", name: "Y" },
        ],
      },
      { date: "2026-03-01T00:00:00.000Z", canyons: [] },
    ];
    expect(distinctCanyonCount(trips)).toBe(2);
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

describe("the current-month bucket in a non-UTC timezone", () => {
  // 00:30 on 1 August in Sydney (UTC+10) — still 31 July in UTC. The whole of
  // the local 1st sits in the previous UTC month, and around 40% of every other
  // local day sits in the previous UTC day.
  const earlyOnTheFirst = new Date("2026-07-31T14:30:00.000Z");

  it("buckets a trip logged 'today' into the month the user is in", () => {
    inTimeZone("Australia/Sydney", () => {
      // Exactly what the trip editor stores for "today" (ui/monthGrid.ts).
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
