import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { currentWeekStart, nextWeekReset, SYDNEY_TZ } from "./weeklyQuota.js";

// Helper: build a JS Date for a given Sydney wall-clock instant.
function sydney(iso: string): Date {
  return DateTime.fromISO(iso, { zone: SYDNEY_TZ }).toJSDate();
}

describe("currentWeekStart", () => {
  it("returns Sunday 00:00 Sydney for a mid-week time", () => {
    // 2026-06-03 is a Wednesday.
    const start = currentWeekStart(sydney("2026-06-03T14:30:00"));
    expect(start.getTime()).toBe(sydney("2026-05-31T00:00:00").getTime());
  });

  it("returns the same day at 00:00 when 'now' is a Sunday", () => {
    // 2026-05-31 is a Sunday.
    const start = currentWeekStart(sydney("2026-05-31T23:59:59"));
    expect(start.getTime()).toBe(sydney("2026-05-31T00:00:00").getTime());
  });

  it("rolls to the new week start exactly at Sunday midnight", () => {
    const start = currentWeekStart(sydney("2026-06-07T00:00:00"));
    expect(start.getTime()).toBe(sydney("2026-06-07T00:00:00").getTime());
  });

  it("still points at the previous Sunday one second before midnight Saturday", () => {
    // 2026-06-06 Saturday 23:59:59 → week began the prior Sunday 2026-05-31.
    const start = currentWeekStart(sydney("2026-06-06T23:59:59"));
    expect(start.getTime()).toBe(sydney("2026-05-31T00:00:00").getTime());
  });
});

describe("nextWeekReset", () => {
  it("is exactly one week after currentWeekStart", () => {
    const now = sydney("2026-06-03T14:30:00");
    const start = currentWeekStart(now);
    const reset = nextWeekReset(now);
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    // Use Luxon to add a week (DST-safe) rather than raw ms arithmetic.
    const expected = DateTime.fromJSDate(start, { zone: SYDNEY_TZ })
      .plus({ weeks: 1 })
      .toJSDate();
    expect(reset.getTime()).toBe(expected.getTime());
    // Sanity: within a few hours of a naive 7-day add (allows DST shift).
    expect(Math.abs(reset.getTime() - (start.getTime() + oneWeekMs))).toBeLessThan(
      4 * 60 * 60 * 1000,
    );
  });

  it("returns the next Sunday for a Sunday input", () => {
    const reset = nextWeekReset(sydney("2026-05-31T10:00:00"));
    expect(reset.getTime()).toBe(sydney("2026-06-07T00:00:00").getTime());
  });
});
