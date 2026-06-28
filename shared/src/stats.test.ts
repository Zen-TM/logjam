import { describe, it, expect } from "vitest";
import { median, quantile } from "./stats.js";

describe("median", () => {
  it("returns null for empty", () => {
    expect(median([])).toBeNull();
  });
  it("single element", () => {
    expect(median([5])).toBe(5);
  });
  it("odd length", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("even length averages the middle two", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("does not mutate input", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("quantile", () => {
  it("returns null for empty", () => {
    expect(quantile([], 0.5)).toBeNull();
  });
  it("single element regardless of q", () => {
    expect(quantile([7], 0.9)).toBe(7);
  });
  it("q=0.5 equals median", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(median([1, 2, 3, 4]));
  });
  it("endpoints are min/max", () => {
    expect(quantile([10, 20, 30], 0)).toBe(10);
    expect(quantile([10, 20, 30], 1)).toBe(30);
  });
  it("linear interpolation (p90 of 1..10)", () => {
    // R-7: pos = 0.9 * 9 = 8.1 → between index 8 (9) and 9 (10) → 9.1
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1, 6);
  });
  it("clamps q out of range", () => {
    expect(quantile([1, 2, 3], -1)).toBe(1);
    expect(quantile([1, 2, 3], 5)).toBe(3);
  });
});
