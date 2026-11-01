import { describe, expect, it } from "vitest";
import { pickDay } from "./dayRange.js";

describe("picking a date range", () => {
  // Mutation: let a later tap replace the start, and the second tap can
  // never end a range.
  it("the first tap starts, a later one ends", () => {
    const started = pickDay({ start: null, end: null }, "2026-11-07");
    expect(started).toEqual({ start: "2026-11-07", end: null });
    expect(pickDay(started, "2026-11-09")).toEqual({
      start: "2026-11-07",
      end: "2026-11-09",
    });
  });

  // Mutation: swap an earlier tap into a range (the old Logjam GPS rule), and
  // a mistaken first tap can't be corrected by tapping the right start.
  it("an earlier day, the same day or a finished range starts over", () => {
    const started = { start: "2026-11-07", end: null };
    expect(pickDay(started, "2026-11-05")).toEqual({
      start: "2026-11-05",
      end: null,
    });
    expect(
      pickDay({ start: "2026-11-07", end: "2026-11-09" }, "2026-11-12"),
    ).toEqual({ start: "2026-11-12", end: null });
  });

  // Mutation: end the range on the start day ({start, end: start}), and a
  // one-day trip is stored as two different values.
  it("the start day again leaves a one-day trip", () => {
    const one = { start: "2026-11-07", end: null };
    expect(pickDay(one, "2026-11-07")).toEqual(one);
    expect(
      pickDay({ start: "2026-11-07", end: "2026-11-07" }, "2026-11-07"),
    ).toEqual(one);
    expect(
      pickDay({ start: "2026-11-07", end: "2026-11-09" }, "2026-11-07"),
    ).toEqual(one);
  });
});
