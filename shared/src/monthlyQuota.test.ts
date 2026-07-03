import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  currentMonthStart,
  nextMonthReset,
  SYDNEY_TZ,
  estimateElvisTileCount,
} from "./monthlyQuota.js";

// Helper: build a JS Date for a given Sydney wall-clock instant.
function sydney(iso: string): Date {
  return DateTime.fromISO(iso, { zone: SYDNEY_TZ }).toJSDate();
}

describe("currentMonthStart", () => {
  it("returns the 1st 00:00 Sydney for a mid-month time", () => {
    const start = currentMonthStart(sydney("2026-06-17T14:30:00"));
    expect(start.getTime()).toBe(sydney("2026-06-01T00:00:00").getTime());
  });

  it("returns the same day at 00:00 when 'now' is the 1st", () => {
    const start = currentMonthStart(sydney("2026-06-01T23:59:59"));
    expect(start.getTime()).toBe(sydney("2026-06-01T00:00:00").getTime());
  });

  it("rolls to the new month start exactly at 1st midnight", () => {
    const start = currentMonthStart(sydney("2026-07-01T00:00:00"));
    expect(start.getTime()).toBe(sydney("2026-07-01T00:00:00").getTime());
  });

  it("still points at the 1st one second before midnight on the last day", () => {
    // 2026-06-30 23:59:59 → month began 2026-06-01.
    const start = currentMonthStart(sydney("2026-06-30T23:59:59"));
    expect(start.getTime()).toBe(sydney("2026-06-01T00:00:00").getTime());
  });
});

describe("nextMonthReset", () => {
  it("is the 1st of the following month", () => {
    const reset = nextMonthReset(sydney("2026-06-17T14:30:00"));
    expect(reset.getTime()).toBe(sydney("2026-07-01T00:00:00").getTime());
  });

  it("rolls year boundary from December to January", () => {
    const reset = nextMonthReset(sydney("2026-12-15T10:00:00"));
    expect(reset.getTime()).toBe(sydney("2027-01-01T00:00:00").getTime());
  });

  it("returns the next month's 1st for a 1st-of-month input", () => {
    const reset = nextMonthReset(sydney("2026-06-01T10:00:00"));
    expect(reset.getTime()).toBe(sydney("2026-07-01T00:00:00").getTime());
  });
});

describe("estimateElvisTileCount", () => {
  it("returns 0 for zero, negative, or non-finite area", () => {
    expect(estimateElvisTileCount(0)).toBe(0);
    expect(estimateElvisTileCount(-5)).toBe(0);
    expect(estimateElvisTileCount(NaN)).toBe(0);
    expect(estimateElvisTileCount(Infinity)).toBe(0);
  });

  it("counts a sub-tile area as one tile", () => {
    expect(estimateElvisTileCount(1)).toBe(1);
  });

  it("divides by the 4 km² tile size on an exact multiple", () => {
    expect(estimateElvisTileCount(8)).toBe(2);
  });

  it("rounds up partial tiles", () => {
    expect(estimateElvisTileCount(9)).toBe(3);
  });
});
