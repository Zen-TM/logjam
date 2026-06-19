import { describe, it, expect } from "vitest";
import { slideshowDots } from "./slideshowDots";

describe("slideshowDots", () => {
  it("returns an empty list for no slides", () => {
    expect(slideshowDots(0, 0, 7)).toEqual([]);
  });

  it("shows one dot per slide when within maxDots", () => {
    const dots = slideshowDots(5, 2, 7);
    expect(dots.map((d) => d.index)).toEqual([0, 1, 2, 3, 4]);
    expect(dots.find((d) => d.index === 2)?.size).toBe("full");
    expect(dots.filter((d) => d.size === "medium")).toHaveLength(4);
  });

  it("never returns more than maxDots dots", () => {
    for (let active = 0; active < 100; active++) {
      const dots = slideshowDots(100, active, 7);
      expect(dots.length).toBeLessThanOrEqual(7);
    }
  });

  it("always includes the active index, marked full", () => {
    for (let active = 0; active < 100; active++) {
      const dots = slideshowDots(100, active, 7);
      const activeDot = dots.find((d) => d.index === active);
      expect(activeDot).toBeTruthy();
      expect(activeDot?.size).toBe("full");
    }
  });

  it("returns indices in monotonic order", () => {
    const dots = slideshowDots(100, 50, 7);
    const indices = dots.map((d) => d.index);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
  });

  it("shrinks the window edge that hides further slides", () => {
    // Active in the middle: both edges hide slides → both small.
    const middle = slideshowDots(100, 50, 7);
    expect(middle[0].size).toBe("small");
    expect(middle[middle.length - 1].size).toBe("small");

    // Active at the very start: nothing hidden before, more after.
    const start = slideshowDots(100, 0, 7);
    expect(start[0].size).toBe("full");
    expect(start[start.length - 1].size).toBe("small");
  });

  it("clamps an out-of-range active index", () => {
    expect(() => slideshowDots(10, 99, 7)).not.toThrow();
    const dots = slideshowDots(10, 99, 7);
    expect(dots.find((d) => d.size === "full")?.index).toBe(9);
  });
});
