import { describe, expect, it } from "vitest";

import { syncAgeLabel } from "./syncAge";

const DAY = 24 * 60 * 60 * 1000;
// Local noon, so the weekday does not depend on the runner's time zone.
const noon = (y: number, m: number, d: number) => new Date(y, m, d, 12);
const iso = (d: Date) => d.toISOString();

describe("syncAgeLabel", () => {
  const now = noon(2026, 10, 3).getTime(); // Tuesday 3 Nov

  // Mutation: lower the threshold to an hour, and a phone that synced this
  // morning says it is out of date.
  it("says nothing within a day", () => {
    expect(syncAgeLabel(iso(new Date(now - DAY)), now)).toBeNull();
    expect(syncAgeLabel(iso(new Date(now - 3_600_000)), now)).toBeNull();
  });

  it("names the weekday inside a week", () => {
    expect(syncAgeLabel(iso(noon(2026, 10, 1)), now)).toBe("synced Sun");
  });

  it("names the date from a week on", () => {
    expect(syncAgeLabel(iso(noon(2026, 9, 12)), now)).toBe("synced 12 Oct");
  });

  it("says nothing without a date", () => {
    expect(syncAgeLabel(null, now)).toBeNull();
    expect(syncAgeLabel("not a date", now)).toBeNull();
  });
});
