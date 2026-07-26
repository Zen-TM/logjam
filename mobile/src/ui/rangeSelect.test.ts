import { describe, expect, it } from "vitest";

import { formatRange, isFullRange, nextRange } from "./rangeSelect";

describe("nextRange", () => {
  it("starts a range from nothing", () => {
    expect(nextRange(null, 3)).toEqual([3, 3]);
  });

  it("clears when the only selected value is tapped again", () => {
    expect(nextRange([3, 3], 3)).toBeNull();
  });

  it("grows downward and upward from either end", () => {
    expect(nextRange([3, 3], 5)).toEqual([3, 5]);
    expect(nextRange([3, 5], 1)).toEqual([1, 5]);
    expect(nextRange([3, 5], 7)).toEqual([3, 7]);
  });

  it("collapses to the tapped value when it is already inside a wider range", () => {
    expect(nextRange([1, 5], 4)).toEqual([4, 4]);
    expect(nextRange([1, 5], 1)).toEqual([1, 1]);
    expect(nextRange([1, 5], 5)).toEqual([5, 5]);
  });

  it("never produces an inverted range", () => {
    const ranges: ([number, number] | null)[] = [null, [1, 1], [3, 3], [2, 6]];
    for (const range of ranges) {
      for (const tap of [1, 2, 3, 4, 5, 6, 7]) {
        const next = nextRange(range, tap);
        if (next) expect(next[0]).toBeLessThanOrEqual(next[1]);
      }
    }
  });
});

describe("isFullRange", () => {
  it("treats null and the whole span as inactive", () => {
    expect(isFullRange(null, [1, 7])).toBe(true);
    expect(isFullRange([1, 7], [1, 7])).toBe(true);
    expect(isFullRange([1, 6], [1, 7])).toBe(false);
  });
});

describe("formatRange", () => {
  it("reads as Any when inactive, a single value when collapsed", () => {
    expect(formatRange(null, [1, 7])).toBe("Any");
    expect(formatRange([4, 4], [1, 7], "V")).toBe("V4");
    expect(formatRange([3, 5], [1, 7], "V")).toBe("V3–V5");
  });
});
