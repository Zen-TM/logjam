import { describe, it, expect } from "vitest";
import { haversineMeters, withinBbox } from "./canyonGeo.js";

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters(-33.5, 150.3, -33.5, 150.3)).toBe(0);
  });
  it("matches a known Sydney→Katoomba distance (~89 km)", () => {
    const d = haversineMeters(-33.8688, 151.2093, -33.7141, 150.3119);
    expect(d).toBeGreaterThan(82_000);
    expect(d).toBeLessThan(95_000);
  });
  it("computes sub-km distances correctly", () => {
    const d = haversineMeters(-33.5, 150.3, -33.5009, 150.3);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });
});

describe("withinBbox", () => {
  it("returns true inside box", () => {
    expect(withinBbox(-33.5, 150.3, -33.49, 150.31, 0.05)).toBe(true);
  });
  it("returns false outside box", () => {
    expect(withinBbox(-33.5, 150.3, -33.3, 150.3, 0.05)).toBe(false);
  });
});
