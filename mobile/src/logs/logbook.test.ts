import { describe, expect, it } from "vitest";

import {
  countTripsInLastMonths,
  distinctCanyonCount,
  formatTripDate,
  groupTripsByYear,
  monthlyTripCounts,
  tripYear,
} from "./logbook";

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
