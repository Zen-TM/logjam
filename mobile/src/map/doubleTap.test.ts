import { describe, expect, it } from "vitest";

import { DOUBLE_TAP_MS, DOUBLE_TAP_SLOP_PX, isDoubleTap } from "./doubleTap";

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
