import { describe, expect, it } from "vitest";

import {
  HEADING_MAX_SLEW_DEG_PER_S,
  normalizeBearing,
  resolveTrueHeading,
  shortestAngleDelta,
  smoothHeading,
} from "./heading";

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
    heading = smoothHeading(heading, 30);
    expect(heading).toBeGreaterThan(0);
    expect(heading).toBeLessThan(30);
    for (let i = 0; i < 40; i++) heading = smoothHeading(heading, 30);
    expect(heading).toBeCloseTo(30, 1);
  });

  it("flattens standstill wobble", () => {
    // The platform reports in steps of at least 2°, so this is what a phone
    // lying still on a rock actually sends. It must not move the arrow a degree.
    let heading = 90;
    for (const sample of [93, 87, 92, 88, 91, 89]) {
      heading = smoothHeading(heading, sample);
    }
    expect(Math.abs(shortestAngleDelta(90, heading))).toBeLessThan(1);
  });

  it("is the same filter whether the platform reports fast or slow", () => {
    // The delivery rate is not ours to choose and is not steady. Ten samples
    // 50 ms apart must land in the same place as one 500 ms apart, or the
    // compass feels different depending on how fast the user happens to be
    // turning. (A small delta, so the slew ceiling — which is a rate and so
    // legitimately depends on the gap — is not what is being measured here.)
    let fast = 0;
    for (let i = 0; i < 10; i++) fast = smoothHeading(fast, 10, 50);
    const slow = smoothHeading(0, 10, 500);
    expect(fast).toBeCloseTo(slow, 1);
  });

  it("never turns the display faster than the slew ceiling", () => {
    // THE JITTER FIX: a magnetometer spike is a 180° delta arriving in one
    // sample, and it used to be passed straight through as a snap.
    const step = smoothHeading(0, 180, 200);
    const perSecond = (Math.abs(shortestAngleDelta(0, step)) * 1000) / 200;
    expect(perSecond).toBeLessThanOrEqual(HEADING_MAX_SLEW_DEG_PER_S + 0.001);
  });

  it("still keeps up with a real turn", () => {
    // The other half of the trade: damping that stops the jitter must not turn
    // the compass into something you wait for. 200 ms samples, the platform's
    // own cadence — a half-turn of the body, settled within a few degrees in
    // two seconds.
    let heading = 0;
    for (let i = 0; i < 10; i++) heading = smoothHeading(heading, 180, 200);
    expect(Math.abs(shortestAngleDelta(180, heading))).toBeLessThan(5);
  });
});

describe("resolveTrueHeading", () => {
  it("passes a real true heading through untouched", () => {
    expect(resolveTrueHeading({ trueHeading: 42, magHeading: 30 })).toBe(42);
    expect(resolveTrueHeading({ trueHeading: 0, magHeading: 350 })).toBe(0);
  });

  it("corrects magnetic for NSW declination when true is unavailable", () => {
    // Facing true north, the magnetometer reads 347.5° in the Blue Mountains.
    expect(resolveTrueHeading({ trueHeading: -1, magHeading: 347.5 })).toBeCloseTo(
      0,
      6,
    );
    expect(resolveTrueHeading({ trueHeading: -1, magHeading: 100 })).toBeCloseTo(
      112.5,
      6,
    );
  });

  it("wraps past 360 rather than returning an out-of-range bearing", () => {
    expect(resolveTrueHeading({ trueHeading: -1, magHeading: 355 })).toBeCloseTo(
      7.5,
      6,
    );
  });

  it("returns null when the device has no usable heading at all", () => {
    expect(resolveTrueHeading({ trueHeading: -1, magHeading: -1 })).toBeNull();
  });
});

describe("normalizeBearing", () => {
  it("folds any bearing into 0..360", () => {
    expect(normalizeBearing(0)).toBe(0);
    expect(normalizeBearing(370)).toBe(10);
    expect(normalizeBearing(-10)).toBe(350);
    expect(normalizeBearing(-370)).toBe(350);
  });

  it("reads a non-finite bearing as north rather than poisoning a camera stop", () => {
    expect(normalizeBearing(NaN)).toBe(0);
    expect(normalizeBearing(Infinity)).toBe(0);
  });
});
