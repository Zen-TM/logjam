import { describe, expect, it } from "vitest";
import { inRange, monthGrid, pickDay } from "./dateRange";

describe("picking a date range", () => {
  // Mutation: let a later click replace the start, and the second click can
  // never end a range.
  it("the first click starts, a later one ends", () => {
    const started = pickDay({ start: null, end: null }, "2026-11-07");
    expect(started).toEqual({ start: "2026-11-07", end: null });
    expect(pickDay(started, "2026-11-09")).toEqual({
      start: "2026-11-07",
      end: "2026-11-09",
    });
  });

  // Mutation: end on an earlier day, and the range runs backwards.
  it("an earlier day, the same day or a finished range starts over", () => {
    const started = { start: "2026-11-07", end: null };
    expect(pickDay(started, "2026-11-05")).toEqual({
      start: "2026-11-05",
      end: null,
    });
    expect(pickDay(started, "2026-11-07")).toEqual(started);
    expect(
      pickDay({ start: "2026-11-07", end: "2026-11-09" }, "2026-11-12"),
    ).toEqual({ start: "2026-11-12", end: null });
  });

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
