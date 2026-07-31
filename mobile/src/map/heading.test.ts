import { describe, expect, it } from "vitest";

import { shortestAngleDelta, smoothHeading } from "./heading";

describe("shortestAngleDelta", () => {
  it("takes the short way across north", () => {
    expect(shortestAngleDelta(350, 10)).toBe(20);
    expect(shortestAngleDelta(10, 350)).toBe(-20);
  });

  it("is zero for the same bearing", () => {
    expect(shortestAngleDelta(123, 123)).toBe(0);
  });
});

describe("smoothHeading", () => {
  it("takes the first sample as-is", () => {
    expect(smoothHeading(null, 42)).toBe(42);
  });

  it("never crosses the wrong side of north", () => {
    // The bug this exists to prevent: a plain average of 358 and 2 is 180.
    const next = smoothHeading(358, 2);
    expect(next > 358 || next < 2).toBe(true);
  });

  it("converges on a steady bearing instead of snapping to it", () => {
    let heading = smoothHeading(null, 0);
    for (let i = 0; i < 3; i++) heading = smoothHeading(heading, 30);
    expect(heading).toBeGreaterThan(0);
    expect(heading).toBeLessThan(30);
    for (let i = 0; i < 40; i++) heading = smoothHeading(heading, 30);
    expect(heading).toBeCloseTo(30, 1);
  });

  it("flattens standstill wobble", () => {
    // ±3° noise around 90° must not move the output more than a degree.
    let heading = 90;
    for (const sample of [93, 87, 92, 88, 91, 89]) {
      heading = smoothHeading(heading, sample);
    }
    expect(Math.abs(shortestAngleDelta(90, heading))).toBeLessThan(1);
  });

  it("follows a real turn immediately rather than crawling", () => {
    expect(smoothHeading(10, 190)).toBe(190);
  });
});
