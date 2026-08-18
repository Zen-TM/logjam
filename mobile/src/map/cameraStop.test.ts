import { describe, expect, it } from "vitest";

import { withDefaultEasing } from "./cameraStop";

describe("withDefaultEasing", () => {
  it("eases a stop that names only a duration", () => {
    // The MLRN 11 regression: this used to ease by default and now jumps.
    expect(withDefaultEasing({ center: [150.4, -33.5], duration: 600 })).toEqual({
      center: [150.4, -33.5],
      duration: 600,
      easing: "ease",
    });
  });

  it("leaves an explicit easing alone", () => {
    // The heading ticker asks for "linear" on purpose: a stream of eases never
    // leaves the slow opening of a curve it never finishes, which reads as one
    // lurch per camera write (see mobile/CLAUDE.md).
    const stop = withDefaultEasing({
      bearing: 12,
      duration: 120,
      easing: "linear" as const,
    });
    expect(stop.easing).toBe("linear");
  });

  it("leaves a zero-duration stop as a jump", () => {
    // Every frame of a pinch: the fingers are the animation.
    expect(withDefaultEasing({ center: [150.4, -33.5], duration: 0 })).toEqual({
      center: [150.4, -33.5],
      duration: 0,
    });
  });

  it("leaves a stop with no duration as a jump", () => {
    // The post-settle reset writes an empty stop meaning "stay where you are";
    // giving it an easing would animate a move to nowhere.
    expect(withDefaultEasing({})).toEqual({});
  });
});
