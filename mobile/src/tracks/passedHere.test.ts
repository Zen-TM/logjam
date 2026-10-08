import { describe, expect, it } from "vitest";

import { passedHereText } from "./passedHere";

const MIN = 60_000;
const minutes = () => (ms: number) => `t${ms / MIN}`;
const pass = (at: number, from = at, to = at) => ({
  atMs: at * MIN,
  fromMs: from * MIN,
  toMs: to * MIN,
});

describe("passedHereText", () => {
  it("says nothing when the track has no time for the spot", () => {
    expect(passedHereText([], minutes)).toBeNull();
  });

  it("gives a walk past one time and a stop its span", () => {
    expect(passedHereText([pass(10, 9, 11)], minutes)).toBe(
      "This track passed here at t10.",
    );
    expect(passedHereText([pass(20, 10, 55)], minutes)).toBe(
      "This track was here from t10 to t55.",
    );
  });

  it("lists every leg of an out and back, and counts the rest of a lap track", () => {
    expect(passedHereText([pass(10), pass(90)], minutes)).toBe(
      "This track passed here at t10 and t90.",
    );
    expect(
      passedHereText(
        [10, 20, 30, 40, 50, 60].map((at) => pass(at)),
        minutes,
      ),
    ).toBe("This track passed here at t10, t20, t30, t40 and 2 more times.");
  });
});
