import { describe, expect, it } from "vitest";

import { passedHereText } from "./passedHere";

const MIN = 60_000;
const SPAN = { startMs: 0, endMs: 200 * MIN };
const minutes = () => (ms: number) => `t${ms / MIN}`;
const pass = (at: number, from = at, to = at) => ({
  atMs: at * MIN,
  fromMs: from * MIN,
  toMs: to * MIN,
});

describe("passedHereText", () => {
  it("says nothing when the track has no time for the spot", () => {
    expect(passedHereText([], SPAN, minutes)).toBeNull();
  });

  it("gives a walk past one time and a stop its span", () => {
    expect(passedHereText([pass(10, 9, 11)], SPAN, minutes)).toBe(
      "This point was passed at t10.",
    );
    expect(passedHereText([pass(20, 10, 55)], SPAN, minutes)).toBe(
      "The track was at this point from t10 to t55.",
    );
  });

  it("lists every leg of an out and back, and counts the rest of a lap track", () => {
    expect(passedHereText([pass(10), pass(90)], SPAN, minutes)).toBe(
      "This point was passed at t10 and t90.",
    );
    expect(
      passedHereText(
        [10, 20, 30, 40, 50, 60].map((at) => pass(at)),
        SPAN,
        minutes,
      ),
    ).toBe("This point was passed at t10, t20, t30, t40 and 2 more times.");
  });

  // Red when a stop in a list of visits reads "at t10 to t55".
  it("says from and to for a stop among other visits", () => {
    expect(passedHereText([pass(20, 10, 55), pass(90)], SPAN, minutes)).toBe(
      "This point was passed from t10 to t55 and at t90.",
    );
  });

  // Red when the day is decided from the visits alone: one visit on a track
  // that ran overnight would not say which day it was.
  it("formats against the whole track, not just the visits", () => {
    const spans: number[][] = [];
    passedHereText([pass(10)], SPAN, (startMs, endMs) => {
      spans.push([startMs, endMs]);
      return minutes();
    });
    expect(spans).toEqual([[SPAN.startMs, SPAN.endMs]]);
  });
});
