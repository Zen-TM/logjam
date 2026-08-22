import { describe, expect, it } from "vitest";

import {
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP_PX,
  isDoubleTap,
  zoomRampValue,
} from "./doubleTap";

const first = { x: 100, y: 200, timeMs: 1_000 };

describe("isDoubleTap", () => {
  it("needs a first tap", () => {
    expect(isDoubleTap(null, first)).toBe(false);
  });

  it("accepts a quick tap on the same spot", () => {
    expect(isDoubleTap(first, { x: 102, y: 198, timeMs: 1_120 })).toBe(true);
  });

  it("accepts the boundary of both bounds", () => {
    expect(
      isDoubleTap(first, {
        x: first.x + DOUBLE_TAP_SLOP_PX,
        y: first.y,
        timeMs: first.timeMs + DOUBLE_TAP_MS,
      }),
    ).toBe(true);
  });

  it("rejects a tap too late — two questions about one spot", () => {
    expect(
      isDoubleTap(first, { ...first, timeMs: first.timeMs + DOUBLE_TAP_MS + 1 }),
    ).toBe(false);
  });

  it("rejects a tap too far — two questions about two spots", () => {
    expect(
      isDoubleTap(first, {
        x: first.x + DOUBLE_TAP_SLOP_PX + 1,
        y: first.y,
        timeMs: first.timeMs + 50,
      }),
    ).toBe(false);
  });

  it("rejects a sample from before the first tap (clock went backwards)", () => {
    expect(isDoubleTap(first, { ...first, timeMs: first.timeMs - 10 })).toBe(false);
  });
});

describe("zoomRampValue", () => {
  it("starts at the current zoom", () => {
    expect(zoomRampValue(14, 15, 0, 200)).toBe(14);
    expect(zoomRampValue(14, 15, -5, 200)).toBe(14);
  });

  it("ends exactly at the target, at and past the duration", () => {
    expect(zoomRampValue(14, 15, 200, 200)).toBe(15);
    expect(zoomRampValue(14, 15, 500, 200)).toBe(15);
  });

  it("is monotonic across the ramp", () => {
    const steps = [0, 40, 80, 120, 160, 200].map((elapsed) =>
      zoomRampValue(14, 15, elapsed, 200),
    );
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
    }
  });

  it("handles a target already reached (no zoom left to give)", () => {
    expect(zoomRampValue(15, 15, 0, 200)).toBe(15);
    expect(zoomRampValue(15, 15, 100, 200)).toBe(15);
    expect(zoomRampValue(15, 15, 200, 200)).toBe(15);
  });
});
