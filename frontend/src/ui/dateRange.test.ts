import { describe, expect, it } from "vitest";
import { inRange, monthGrid } from "./dateRange";

describe("the calendar", () => {
  it("highlights the days from start to end, one for a one-day trip", () => {
    const range = { start: "2026-11-07", end: "2026-11-09" };
    expect(inRange(range, "2026-11-08")).toBe(true);
    expect(inRange(range, "2026-11-10")).toBe(false);
    expect(inRange({ start: "2026-11-07", end: null }, "2026-11-08")).toBe(
      false,
    );
  });

  // Mutation: Sunday-first, and 1 Nov 2026 (a Sunday) lands in column 0.
  it("lays a month out Monday-first in six weeks", () => {
    const grid = monthGrid(2026, 10);
    expect(grid).toHaveLength(42);
    expect(grid.indexOf("2026-11-01")).toBe(6);
    expect(grid.filter(Boolean)).toHaveLength(30);
  });
});
