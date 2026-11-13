import { describe, it, expect } from "vitest";
import { haversineMeters, lonWithin, withinBbox } from "./placeGeo.js";

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

describe("lonWithin", () => {
  it("is a plain inclusive range for a box that stays inside one world copy", () => {
    expect(lonWithin(150.3, 150.2, 150.4)).toBe(true);
    expect(lonWithin(150.2, 150.2, 150.4)).toBe(true);
    expect(lonWithin(150.4, 150.2, 150.4)).toBe(true);
    expect(lonWithin(150.5, 150.2, 150.4)).toBe(false);
    expect(lonWithin(-150.3, 150.2, 150.4)).toBe(false);
  });

  it("holds both sides of 180 for a box that arrives unwrapped (east above 180)", () => {
    expect(lonWithin(175, 170, 190)).toBe(true);
    expect(lonWithin(-175, 170, 190)).toBe(true);
    expect(lonWithin(180, 170, 190)).toBe(true);
    expect(lonWithin(-170, 170, 190)).toBe(true);
    expect(lonWithin(-169, 170, 190)).toBe(false);
    expect(lonWithin(169, 170, 190)).toBe(false);
    expect(lonWithin(0, 170, 190)).toBe(false);
  });

  it("holds both sides of -180 for a box that arrives unwrapped (west below -180)", () => {
    expect(lonWithin(-175, -190, -170)).toBe(true);
    expect(lonWithin(175, -190, -170)).toBe(true);
    expect(lonWithin(170, -190, -170)).toBe(true);
    expect(lonWithin(169, -190, -170)).toBe(false);
    expect(lonWithin(-169, -190, -170)).toBe(false);
  });

  it("holds both sides of 180 for a box that arrives wrapped (west above east)", () => {
    expect(lonWithin(175, 170, -170)).toBe(true);
    expect(lonWithin(-175, 170, -170)).toBe(true);
    expect(lonWithin(170, 170, -170)).toBe(true);
    expect(lonWithin(-170, 170, -170)).toBe(true);
    expect(lonWithin(0, 170, -170)).toBe(false);
    expect(lonWithin(-169, 170, -170)).toBe(false);
  });

  it("reads a box wholly in another world copy as the ground it shows", () => {
    // 520 to 540 is 160 to 180; -200 to -190 is 160 to 170.
    expect(lonWithin(170, 520, 540)).toBe(true);
    expect(lonWithin(-179, 520, 540)).toBe(false);
    expect(lonWithin(165, -200, -190)).toBe(true);
    expect(lonWithin(150.3, 510.2, 510.4)).toBe(true);
    expect(lonWithin(150.3, -209.8, -209.6)).toBe(true);
    expect(lonWithin(150.5, 510.2, 510.4)).toBe(false);
  });

  it("holds every longitude for a box a whole turn wide or more", () => {
    for (const lon of [-180, -90, 0, 90, 180]) {
      expect(lonWithin(lon, -200, 200)).toBe(true);
      expect(lonWithin(lon, -180, 180)).toBe(true);
    }
  });
});
