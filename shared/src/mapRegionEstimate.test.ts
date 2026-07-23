import { describe, expect, it } from "vitest";

import {
  MAX_REGION_TILES,
  SOFT_WARN_TILES,
  checkRegionCaps,
  lonLatToTile,
  planRegionTiles,
  regionEdgesKm,
  xyzToTmsRow,
  type RegionBbox,
} from "./mapRegionEstimate.js";

describe("lonLatToTile", () => {
  it("maps the origin to the centre tile", () => {
    expect(lonLatToTile(0, 0, 1)).toEqual({ x: 1, y: 1 });
  });

  it("matches a known Katoomba z16 tile", () => {
    // Katoomba ≈ 150.312, -33.714 → z16 slippy tile (spec §4.1 fixture zone).
    const { x, y } = lonLatToTile(150.312, -33.714, 16);
    // Independent derivation: x = floor((150.312+180)/360 · 2^16) = 60131
    // y = floor((1 − asinh(tan(−33.714°))/π)/2 · 2^16) = 39293
    expect(x).toBe(60131);
    expect(y).toBe(39293);
  });

  it("clamps at the antimeridian and poles", () => {
    // lon 180 would compute x = 2^z (out of range) — clamped to 2^z − 1.
    // The equator midline falls on row 2^z/2.
    expect(lonLatToTile(180, 0, 2)).toEqual({ x: 3, y: 2 });
    expect(lonLatToTile(-180, 85.05, 2).y).toBe(0);
    expect(lonLatToTile(0, -85.05, 2).y).toBe(3);
  });
});

describe("xyzToTmsRow", () => {
  it("flips symmetric rows", () => {
    expect(xyzToTmsRow(0, 0)).toBe(0);
    expect(xyzToTmsRow(1, 0)).toBe(1);
    expect(xyzToTmsRow(16, 39293)).toBe(65536 - 1 - 39293);
    // Involution: flipping twice returns the original.
    expect(xyzToTmsRow(16, xyzToTmsRow(16, 39293))).toBe(39293);
  });
});

// 10×10 km bbox at Blue Mountains latitude (spec §3.2 validation table).
const TEN_KM: RegionBbox = {
  west: 150.26,
  south: -33.745,
  east: 150.368, // ≈10 km wide at cos(-33.7°)
  north: -33.655, // ≈10 km tall
};

describe("planRegionTiles", () => {
  it("matches the spec's ~545–615 total for 10×10 km z8→16", () => {
    const plan = planRegionTiles(TEN_KM, 8, 16);
    expect(plan.totalTiles).toBeGreaterThanOrEqual(500);
    expect(plan.totalTiles).toBeLessThanOrEqual(650);
    const z16 = plan.perZoom.find((p) => p.z === 16)!;
    expect(z16.count).toBeGreaterThanOrEqual(380);
    expect(z16.count).toBeLessThanOrEqual(462);
  });

  it("per-level counts are exact corner-tile products", () => {
    const plan = planRegionTiles(TEN_KM, 12, 12);
    const p = plan.perZoom[0];
    expect(p.count).toBe((p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1));
    expect(plan.totalTiles).toBe(p.count);
  });

  it("throws on degenerate bboxes and zoom ranges", () => {
    expect(() =>
      planRegionTiles({ west: 1, south: 1, east: 1, north: 2 }, 8, 10),
    ).toThrow();
    expect(() =>
      planRegionTiles({ west: 1, south: 2, east: 2, north: 1 }, 8, 10),
    ).toThrow();
    expect(() => planRegionTiles(TEN_KM, 10, 8)).toThrow();
  });
});

describe("caps", () => {
  it("passes the default 10×10 km region without warning", () => {
    const plan = planRegionTiles(TEN_KM, 8, 16);
    expect(checkRegionCaps(TEN_KM, plan)).toEqual({ ok: true, softWarn: false });
  });

  it("soft-warns between SOFT_WARN_TILES and MAX_REGION_TILES", () => {
    // ~20×20 km at z16 ≈ 1,700–2,300 tiles — inside the hard cap, over soft.
    const bbox: RegionBbox = { west: 150.2, south: -33.79, east: 150.416, north: -33.61 };
    const plan = planRegionTiles(bbox, 8, 16);
    expect(plan.totalTiles).toBeGreaterThan(SOFT_WARN_TILES);
    expect(plan.totalTiles).toBeLessThanOrEqual(MAX_REGION_TILES);
    expect(checkRegionCaps(bbox, plan)).toEqual({ ok: true, softWarn: true });
  });

  it("rejects over-cap tile counts", () => {
    const bbox: RegionBbox = { west: 150.0, south: -33.9, east: 150.45, north: -33.55 };
    const plan = planRegionTiles(bbox, 8, 16);
    expect(plan.totalTiles).toBeGreaterThan(MAX_REGION_TILES);
    expect(checkRegionCaps(bbox, plan)).toEqual({
      ok: false,
      reason: "too-many-tiles",
    });
  });

  it("rejects edges beyond MAX_REGION_EDGE_KM regardless of zoom", () => {
    const bbox: RegionBbox = { west: 150, south: -34, east: 151, north: -33.99 };
    const [w] = regionEdgesKm(bbox);
    expect(w).toBeGreaterThan(50);
    const plan = planRegionTiles(bbox, 8, 8);
    expect(checkRegionCaps(bbox, plan)).toEqual({
      ok: false,
      reason: "edge-too-long",
    });
  });
});
