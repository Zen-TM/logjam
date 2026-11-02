import { describe, expect, it } from "vitest";
import { pickDay, settleDayRange, weekBand } from "./dayRange.js";

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

  // Mutation: return the range untouched, and Done after one tap saves a
  // start with no end.
  it("Done after one tap saves a one-day trip", () => {
    expect(settleDayRange({ start: "2026-11-07", end: null })).toEqual({
      start: "2026-11-07",
      end: "2026-11-07",
    });
    expect(settleDayRange({ start: null, end: null })).toEqual({
      start: null,
      end: null,
    });
    const both = { start: "2026-11-07", end: "2026-11-09" };
    expect(settleDayRange(both)).toEqual(both);
  });
});

describe("the band behind a range", () => {
  const week = [
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
  ];

  // Mutation: leave the start or end day out (the old exclusive band), and
  // the first and last days sit outside it.
  it("includes the first and last day, rounded at the piece ends", () => {
    const band = weekBand({ start: "2026-11-03", end: "2026-11-05" }, week);
    expect(band.map(Boolean)).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(band[1]).toEqual({
      pieceStart: true,
      pieceEnd: false,
    });
    expect(band[2]).toEqual({
      pieceStart: false,
      pieceEnd: false,
    });
    expect(band[3]).toEqual({
      pieceStart: false,
      pieceEnd: true,
    });
  });

  // Mutation: mark only the range's own ends rounded, and a range crossing
  // a week has square ends at the row edge.
  it("rounds the row edge where a range crosses a week", () => {
    const range = { start: "2026-11-06", end: "2026-11-12" };
    const first = weekBand(range, week);
    expect(first[4]).toMatchObject({ pieceStart: true, pieceEnd: false });
    expect(first[6]).toMatchObject({ pieceEnd: true });
    const next = weekBand(range, [
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      null,
      null,
      null,
    ]);
    expect(next[0]).toMatchObject({ pieceStart: true });
    expect(next[3]).toMatchObject({ pieceEnd: true });
  });

  it("is empty for a one-day trip, an open range and a month the range misses", () => {
    expect(
      weekBand({ start: "2026-11-03", end: null }, week).some(Boolean),
    ).toBe(false);
    expect(
      weekBand({ start: "2026-11-03", end: "2026-11-03" }, week).some(Boolean),
    ).toBe(false);
    expect(
      weekBand({ start: "2026-12-03", end: "2026-12-05" }, week).some(Boolean),
    ).toBe(false);
  });
});
