import { describe, expect, it } from "vitest";

import {
  MAX_REGION_TILES,
  REGION_MIN_ZOOM,
  SOFT_WARN_TILES,
  checkRegionCaps,
  estimateRegionSeconds,
  estimateRegionSize,
  lonLatToTile,
  planRegionForBasemaps,
  planRegionTiles,
  regionEdgesKm,
  xyzToTmsRow,
  type OfflineBasemapId,
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
    expect(checkRegionCaps(TEN_KM, plan.totalTiles)).toEqual({ ok: true, softWarn: false });
  });

  it("soft-warns between SOFT_WARN_TILES and MAX_REGION_TILES", () => {
    // ~20×20 km at z16 ≈ 1,700–2,300 tiles — inside the hard cap, over soft.
    const bbox: RegionBbox = { west: 150.2, south: -33.79, east: 150.416, north: -33.61 };
    const plan = planRegionTiles(bbox, 8, 16);
    expect(plan.totalTiles).toBeGreaterThan(SOFT_WARN_TILES);
    expect(plan.totalTiles).toBeLessThanOrEqual(MAX_REGION_TILES);
    expect(checkRegionCaps(bbox, plan.totalTiles)).toEqual({ ok: true, softWarn: true });
  });

  it("rejects over-cap tile counts", () => {
    const bbox: RegionBbox = { west: 150.0, south: -33.9, east: 150.45, north: -33.55 };
    const plan = planRegionTiles(bbox, 8, 16);
    expect(plan.totalTiles).toBeGreaterThan(MAX_REGION_TILES);
    expect(checkRegionCaps(bbox, plan.totalTiles)).toEqual({
      ok: false,
      reason: "too-many-tiles",
    });
  });

  it("rejects edges beyond MAX_REGION_EDGE_KM regardless of zoom", () => {
    const bbox: RegionBbox = { west: 150, south: -34, east: 151, north: -33.99 };
    const [w] = regionEdgesKm(bbox);
    expect(w).toBeGreaterThan(50);
    const plan = planRegionTiles(bbox, 8, 8);
    expect(checkRegionCaps(bbox, plan.totalTiles)).toEqual({
      ok: false,
      reason: "edge-too-long",
    });
  });
});

describe("estimateRegionSize", () => {
  it("weights each level by its own measured tile size", () => {
    // six-base is the source that makes this matter: z12 tiles measured
    // 57.8 KB, z18 tiles 4.3 KB. A pyramid ending at z18 must NOT be priced at
    // the shallow rate, or the estimate is out by an order of magnitude.
    const deep = planRegionTiles(TEN_KM, 17, 18);
    const shallow = planRegionTiles(TEN_KM, 12, 13);
    const perTileDeep = estimateRegionSize(deep, "six-base").meanBytes / deep.totalTiles;
    const perTileShallow =
      estimateRegionSize(shallow, "six-base").meanBytes / shallow.totalTiles;
    expect(perTileShallow).toBeGreaterThan(perTileDeep * 5);
  });

  it("prices z8–z11 at the shallowest measured zoom rather than throwing", () => {
    // Nothing below z12 was sampled (there are ~10 such tiles in a region);
    // they take the nearest measurement instead of a missing-key crash.
    const plan = planRegionTiles(TEN_KM, REGION_MIN_ZOOM, 9);
    const estimate = estimateRegionSize(plan, "six-topo");
    expect(estimate.meanBytes).toBeGreaterThan(0);
    expect(estimate.p90Bytes).toBeGreaterThanOrEqual(estimate.meanBytes);
  });

  it("brackets a real measured download", () => {
    // Ground truth from a region actually downloaded to a phone on 2026-07-30:
    // six-topo over central Katoomba, z8→16, these exact per-level counts, and a
    // finished file of 839,680 bytes on disk.
    //
    // The mean may sit under a town-only download (it is a mean over mixed
    // terrain) but the p90 has to cover it — "up to" is a promise, and this is
    // the case that broke the first, bush-only calibration.
    const measuredFileBytes = 839_680;
    const plan = {
      perZoom: [
        { z: 8, x0: 0, x1: 0, y0: 0, y1: 0, count: 1 },
        { z: 9, x0: 0, x1: 0, y0: 0, y1: 0, count: 1 },
        { z: 10, x0: 0, x1: 0, y0: 0, y1: 0, count: 1 },
        { z: 11, x0: 0, x1: 0, y0: 0, y1: 0, count: 1 },
        { z: 12, x0: 0, x1: 0, y0: 0, y1: 0, count: 1 },
        { z: 13, x0: 0, x1: 0, y0: 0, y1: 0, count: 1 },
        { z: 14, x0: 0, x1: 1, y0: 0, y1: 0, count: 2 },
        { z: 15, x0: 0, x1: 2, y0: 0, y1: 1, count: 6 },
        { z: 16, x0: 0, x1: 4, y0: 0, y1: 3, count: 20 },
      ],
      totalTiles: 34,
    };
    const estimate = estimateRegionSize(plan, "six-topo");
    expect(estimate.p90Bytes).toBeGreaterThan(measuredFileBytes);
    // And not absurdly wide: within 2x of what actually landed.
    expect(estimate.meanBytes).toBeGreaterThan(measuredFileBytes / 2);
  });

  it("throws on an unknown source rather than guessing a size", () => {
    const plan = planRegionTiles(TEN_KM, 12, 12);
    expect(() => estimateRegionSize(plan, "six-nope" as OfflineBasemapId)).toThrow();
  });
});

describe("planRegionForBasemaps", () => {
  const maxZoomFor = (id: OfflineBasemapId) =>
    ({ "six-topo": 16, "six-base": 18, "six-imagery": 18 })[id];

  it("clamps each source to its own deepest served level", () => {
    const job = planRegionForBasemaps(TEN_KM, ["six-topo", "six-base"], 18, maxZoomFor);
    expect(job.perSource.map((s) => s.zMax)).toEqual([16, 18]);
  });

  it("totals tiles and bytes across sources — three maps is three downloads", () => {
    const one = planRegionForBasemaps(TEN_KM, ["six-topo"], 16, maxZoomFor);
    const two = planRegionForBasemaps(
      TEN_KM,
      ["six-topo", "six-imagery"],
      16,
      maxZoomFor,
    );
    expect(two.totalTiles).toBe(one.totalTiles * 2);
    expect(two.meanBytes).toBeGreaterThan(one.meanBytes);
    expect(two.seconds).toBe(estimateRegionSeconds(two.totalTiles));
  });

  it("starts every pyramid at REGION_MIN_ZOOM so a zoomed-out offline map is not blank", () => {
    const job = planRegionForBasemaps(TEN_KM, ["six-topo"], 14, maxZoomFor);
    expect(job.perSource[0].plan.perZoom[0].z).toBe(REGION_MIN_ZOOM);
  });
});
