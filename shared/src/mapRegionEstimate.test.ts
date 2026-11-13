import { describe, expect, it } from "vitest";

import { TERRARIUM } from "./demSources.js";
import { BASEMAP_CATALOG } from "./geoPdfBaseLayers.js";
import { landClip } from "./nswLand.js";
import {
  DEM_SOURCE_ID,
  MAX_REGION_AREA_KM2,
  MAX_REGION_EDGE_KM,
  MAX_REGION_TILES,
  REGION_MIN_ZOOM,
  SOFT_WARN_TILES,
  checkRegionCaps,
  estimateRegionSeconds,
  estimateRegionSize,
  lonLatToTile,
  planDemDownload,
  planRegionForBasemaps,
  demClipMinZoom,
  planRegionTiles,
  regionEdgesKm,
  xyzToTmsRow,
  type MultiSourceRegionPlan,
  type OfflineBasemapId,
  type RegionBbox,
  type SaveClipKind,
} from "./mapRegionEstimate.js";
import { NSW_REGION, type Region } from "./regions.js";
import { SIM_REGIONS, SIM_UTAH, SIM_WORLD } from "./simRegions.js";

describe("lonLatToTile", () => {
  it("maps the origin to the centre tile", () => {
    expect(lonLatToTile(0, 0, 1)).toEqual({ x: 1, y: 1 });
  });

  it("matches a known Katoomba z16 tile", () => {
    // Katoomba ≈ 150.312, -33.714 → z16 slippy tile.
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

// 10×10 km bbox at Blue Mountains latitude.
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
    expect(checkRegionCaps(TEN_KM, plan.totalTiles)).toEqual({
      ok: true,
      softWarn: false,
    });
  });

  it("soft-warns between SOFT_WARN_TILES and MAX_REGION_TILES", () => {
    // ~20×20 km at z16 ≈ 1,700–2,300 tiles — inside the hard cap, over soft.
    const bbox: RegionBbox = {
      west: 150.2,
      south: -33.79,
      east: 150.416,
      north: -33.61,
    };
    const plan = planRegionTiles(bbox, 8, 16);
    expect(plan.totalTiles).toBeGreaterThan(SOFT_WARN_TILES);
    expect(plan.totalTiles).toBeLessThanOrEqual(MAX_REGION_TILES);
    expect(checkRegionCaps(bbox, plan.totalTiles)).toEqual({
      ok: true,
      softWarn: true,
    });
  });

  it("rejects over-cap tile counts", () => {
    const bbox: RegionBbox = {
      west: 150.0,
      south: -33.9,
      east: 150.43,
      north: -33.55,
    };
    const plan = planRegionTiles(bbox, 8, 16);
    expect(plan.totalTiles).toBeGreaterThan(MAX_REGION_TILES);
    expect(checkRegionCaps(bbox, plan.totalTiles)).toEqual({
      ok: false,
      reason: "too-many-tiles",
    });
  });

  // Mutation: apply the area limit only to some saves, and a 50 x 35 km area
  // is offered, then saved without the clips the endpoint refuses to cut.
  it("rejects an area over MAX_REGION_AREA_KM2 whatever is being saved", () => {
    const bbox = { west: 150.0, south: -34.0, east: 150.54, north: -33.69 };
    const [w, h] = regionEdgesKm(bbox);
    expect(Math.max(w, h)).toBeLessThan(MAX_REGION_EDGE_KM);
    expect(w * h).toBeGreaterThan(MAX_REGION_AREA_KM2);
    expect(checkRegionCaps(bbox, 1)).toEqual({
      ok: false,
      reason: "area-too-large",
    });
  });

  it("rejects edges beyond MAX_REGION_EDGE_KM regardless of zoom", () => {
    const bbox: RegionBbox = {
      west: 150,
      south: -34,
      east: 151,
      north: -33.99,
    };
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
    const perTileDeep =
      estimateRegionSize(deep, "six-base").meanBytes / deep.totalTiles;
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
    // Ground truth from a region downloaded to a phone: six-topo over central
    // Katoomba, z8→16, these exact per-level counts, and a finished file of
    // 839,680 bytes on disk.
    //
    // The mean may sit under a town-only download (it is a mean over mixed
    // terrain) but the p90 has to cover it — "up to" is a promise, and a
    // bush-only calibration would under-predict it.
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
    expect(() => estimateRegionSize(plan, "six-nope")).toThrow();
  });

  // Mutation: drop the offline-capable raster check in `pyramidTileBytes` and
  // the refusal is a TypeError on missing figures, not the named error.
  it("refuses a basemap that is not a downloadable raster", () => {
    const plan = planRegionTiles(TEN_KM, 12, 12);
    const refused = BASEMAP_CATALOG.filter(
      (e) => !(e.offlineCapable && e.kind === "raster"),
    );
    expect(refused.map((e) => e.id)).toContain("osm");
    expect(refused.map((e) => e.id)).toContain("protomaps");
    for (const { id } of refused)
      expect(() => estimateRegionSize(plan, id)).toThrow(/Unknown offline/);
  });
});

describe("planRegionForBasemaps", () => {
  const maxZoomFor = (id: OfflineBasemapId) =>
    ({ "six-topo": 16, "six-base": 18, "six-imagery": 18 })[id]!;
  const clip = (job: MultiSourceRegionPlan, kind: SaveClipKind) =>
    job.clips.find((c) => c.kind === kind)!.size;

  /** The basemap pyramids only — every plan also carries the DEM (see below). */
  const basemapSources = (job: ReturnType<typeof planRegionForBasemaps>) =>
    job.perSource.filter((s) => s.basemapId !== DEM_SOURCE_ID);

  // Mutation: save only the finest DEM that covers the area and a line that
  // leaves it offline has no height, and no source to measure the seam in.
  it("saves a clip of every DEM archive the area touches, on top of the worldwide tiles", () => {
    const job = planRegionForBasemaps(TEN_KM, [], 15, maxZoomFor);
    expect(
      job.clips.filter((c) => c.kind === "heights").map((c) => c.archive.id),
    ).toEqual(["nsw-5m"]);
    expect(job.perSource.map((s) => s.basemapId)).toEqual([DEM_SOURCE_ID]);
    // The clips count toward the bytes the free-space check reads, not the
    // tiles the politeness cap counts.
    const tiles = job.perSource.reduce((sum, s) => sum + s.plan.totalTiles, 0);
    expect(job.totalTiles).toBe(tiles);
    expect(job.clips.map((c) => c.kind)).toEqual([
      "heights",
      "slope",
      "contours",
      "land",
      "fire",
      "coverage",
    ]);
    expect(job.p90Bytes).toBe(
      job.perSource[0].size.p90Bytes +
        job.clips.reduce((sum, c) => sum + c.size.p90Bytes, 0),
    );
  });

  // Mutation: price the height clip at z15 alone and an area's estimate
  // undercounts the z8-14 tiles the hillshade is drawn from offline.
  it("prices the height clip at every zoom the hillshade is drawn at", () => {
    const b = { west: 150.2, south: -33.78, east: 150.3, north: -33.69 };
    const heights = clip(
      planRegionForBasemaps(b, [], 15, maxZoomFor),
      "heights",
    );
    const z15 = planRegionTiles(b, 15, 15).totalTiles;
    expect(heights.meanBytes).toBeGreaterThan(z15 * 24_000 * 1.5);
    expect(demClipMinZoom(NSW_REGION.terrain.heights)).toBe(8);
    expect(demClipMinZoom(TERRARIUM)).toBe(TERRARIUM.sampleZoom);
  });

  // Mutation: leave the contour clip out of the totals and the free-space
  // check passes an area whose download then does not fit.
  it("counts the contour clip in the bytes", () => {
    const job = planRegionForBasemaps(TEN_KM, [], 15, maxZoomFor);
    // A real clip of 10 km of the Grose gorge is 1.7 MB.
    expect(clip(job, "contours").meanBytes).toBeGreaterThan(1_200_000);
    expect(clip(job, "contours").p90Bytes).toBeLessThan(2_500_000);
    expect(job.meanBytes).toBe(
      job.perSource[0].size.meanBytes +
        job.clips.reduce((sum, c) => sum + c.size.meanBytes, 0),
    );
  });

  // Mutation: halve the fire archive's `tileBytes`, and the estimate no longer brackets the
  // measured clip. (Leaving it out of the totals turns the two sum tests
  // above red.)
  it("prices the fire clip from its measured tiles", () => {
    // A real clip of 40 km of the Blue Mountains is 795 KB.
    const box = { west: 150.05, south: -33.95, east: 150.5, north: -33.55 };
    const fire = clip(planRegionForBasemaps(box, [], 15, maxZoomFor), "fire");
    expect(fire.meanBytes).toBeGreaterThan(650_000);
    expect(fire.meanBytes).toBeLessThan(950_000);
    expect(fire.p90Bytes).toBeGreaterThan(795_000);
    expect(fire.p90Bytes).toBeLessThan(2_500_000);
  });

  // Mutation: halve the coverage archive's `tileBytes`, and the estimate no longer brackets
  // the measured clip. (Leaving it out of the totals turns the two sum tests
  // above red.)
  it("prices the coverage clip from its measured tiles", () => {
    // A real clip of 40 km of the Blue Mountains is 346 KB: 42 z12 tiles.
    const box = { west: 150.05, south: -33.95, east: 150.5, north: -33.55 };
    const coverage = clip(
      planRegionForBasemaps(box, [], 15, maxZoomFor),
      "coverage",
    );
    expect(coverage.meanBytes).toBeGreaterThan(300_000);
    expect(coverage.meanBytes).toBeLessThan(400_000);
    expect(coverage.p90Bytes).toBeGreaterThan(400_000);
    expect(coverage.p90Bytes).toBeLessThan(700_000);
  });

  // Mutation: halve the land archive's `tileBytes`, and the estimate no longer brackets the
  // measured clip. (Leaving Land out of the totals turns the two sum tests
  // above red.)
  it("prices the land clip from its measured tiles", () => {
    // A real clip of 40 km of the Blue Mountains is 769 KB.
    const box = { west: 150.05, south: -33.95, east: 150.5, north: -33.55 };
    const land = clip(planRegionForBasemaps(box, [], 15, maxZoomFor), "land");
    expect(land.meanBytes).toBeGreaterThan(600_000);
    expect(land.meanBytes).toBeLessThan(950_000);
    expect(land.p90Bytes).toBeGreaterThan(769_000);
    expect(land.p90Bytes).toBeLessThan(2_000_000);
  });

  // Mutation: halve the slope archive's `tileBytes`, and the estimate no longer brackets
  // the measured clip. (Leaving the slope out of the totals
  // turns the two sum tests above red.)
  it("prices the slope clip from its measured tiles", () => {
    const job = planRegionForBasemaps(TEN_KM, [], 15, maxZoomFor);
    // A real clip of this area, from the Katoomba sheet's slope, is 6.0 MB.
    const slope = clip(job, "slope");
    expect(slope.meanBytes).toBeGreaterThan(4_500_000);
    expect(slope.meanBytes).toBeLessThan(6_000_000);
    expect(slope.p90Bytes).toBeGreaterThan(6_000_000);
    expect(slope.p90Bytes).toBeLessThan(8_000_000);
  });

  // Mutation: delete one zoom from an archive's `tileBytes` and planning an
  // area inside it throws, whichever archive it is.
  it("holds figures for every zoom a save clips", () => {
    let archives = 0;
    for (const region of [NSW_REGION, ...SIM_REGIONS, SIM_WORLD]) {
      const { heights, slope, contours, land, fire, coverage } = region.terrain;
      const zooms = [
        heights && [
          demClipMinZoom(heights, [region]),
          heights.sampleZoom,
          heights,
        ],
        slope && [slope.minzoom, slope.maxzoom, slope],
        contours && [contours.minzoom, contours.maxzoom, contours],
        land && [landClip(land).minzoom, land.maxzoom, land],
        fire && [fire.minzoom, fire.maxzoom, fire],
        coverage && [coverage.minzoom, coverage.maxzoom, coverage],
      ].filter((z) => !!z) as [number, number, { tileBytes: object }][];
      for (const [min, max, { tileBytes }] of zooms) {
        archives++;
        for (let z = min; z <= max; z++)
          expect(tileBytes, `${region.id} at z${z}`).toHaveProperty(`${z}`);
      }
    }
    // Six of NSW, three of each simulated region, the world's heights.
    expect(archives).toBeGreaterThanOrEqual(6 + 3 + 3 + 1);
  });

  // Mutation: read the clips from `REGIONS` instead of the `regions` argument,
  // and a simulated box is priced as a box in the sea.
  it("clips the archives of the simulated region a box lies in, and only those", () => {
    const wanaka = { west: 169.05, south: -44.65, east: 169.15, north: -44.6 };
    const job = planRegionForBasemaps(wanaka, [], 15, maxZoomFor, SIM_REGIONS);
    expect(job.clips.map((c) => [c.archive.id, c.kind])).toEqual([
      ["simnz-heights", "heights"],
      ["simnz-slope", "slope"],
      ["simnz-contours", "contours"],
    ]);
    // Placeholder figures, 30 KB a tile at every zoom: the tile counts say the rest.
    const tiles = (min: number, max: number) =>
      planRegionTiles(wanaka, min, max).totalTiles;
    expect(job.clips.map((c) => c.size.meanBytes)).toEqual([
      tiles(8, 15) * 30_000,
      tiles(8, 15) * 30_000,
      tiles(11, 14) * 30_000,
    ]);
    // NSW is not touched, so none of its archives are priced.
    expect(job.clips.some((c) => c.archive.id.startsWith("nsw"))).toBe(false);
  });

  // Mutation: stop at the first region touching the box, and the second
  // region's archives are never saved.
  it("clips the archives of every region a box touches", () => {
    // Utah's declaration with NSW's border: two regions over the same ground.
    const overlap: Region = { ...SIM_UTAH, borders: NSW_REGION.borders };
    const job = planRegionForBasemaps(TEN_KM, [], 15, maxZoomFor, [
      NSW_REGION,
      overlap,
    ]);
    expect(
      job.clips.filter((c) => c.kind === "slope").map((c) => c.archive.id),
    ).toEqual(["nsw-5m-slope", "simutah-slope"]);
    // Utah's heights lie far from this box, so only its slope and contours add.
    expect(job.clips.filter((c) => c.kind === "heights")).toHaveLength(1);
  });

  it("saves the clips of the one region in a box that touches only it, with every region on", () => {
    const only = (box: RegionBbox) =>
      planRegionForBasemaps(box, [], 15, maxZoomFor, [
        NSW_REGION,
        ...SIM_REGIONS,
      ]).clips.map((c) => c.archive.id.split("-")[0]);
    expect(new Set(only(TEN_KM))).toEqual(new Set(["nsw"]));
    expect(
      new Set(only({ west: -110.85, south: 38.25, east: -110.8, north: 38.3 })),
    ).toEqual(new Set(["simutah"]));
  });

  it("saves no archive for an area outside every archive's coverage", () => {
    const perth = { west: 115.8, south: -32.0, east: 115.9, north: -31.9 };
    expect(planDemDownload(perth)).toEqual([]);
    expect(planDemDownload(TEN_KM).map((s) => s.id)).toEqual(["nsw-5m"]);
  });

  it("clamps each source to its own deepest served level", () => {
    const job = planRegionForBasemaps(
      TEN_KM,
      ["six-topo", "six-base"],
      18,
      maxZoomFor,
    );
    expect(basemapSources(job).map((s) => s.zMax)).toEqual([16, 18]);
  });

  it("totals tiles and bytes across sources — three maps is three downloads", () => {
    const one = planRegionForBasemaps(TEN_KM, ["six-topo"], 16, maxZoomFor);
    const two = planRegionForBasemaps(
      TEN_KM,
      ["six-topo", "six-imagery"],
      16,
      maxZoomFor,
    );
    const dem = one.perSource.find((s) => s.basemapId === DEM_SOURCE_ID)!;
    // The DEM is in both plans once, so it cancels out of the doubling.
    expect(two.totalTiles - dem.plan.totalTiles).toBe(
      (one.totalTiles - dem.plan.totalTiles) * 2,
    );
    expect(two.meanBytes).toBeGreaterThan(one.meanBytes);
    expect(two.seconds).toBe(estimateRegionSeconds(two.totalTiles));
  });

  // The DEM rides along unasked (that is the feature), so the two things that
  // could quietly go wrong are: it stops riding along, or it starts scaling
  // with the detail rail and blows out a download the user sized by eye.
  it("saves the DEM with every region, at one flat level, whatever is selected", () => {
    for (const ids of [
      [],
      ["six-topo"],
      ["six-topo", "six-imagery"],
    ] as const) {
      const job = planRegionForBasemaps(TEN_KM, [...ids], 16, maxZoomFor);
      const dem = job.perSource.filter((s) => s.basemapId === DEM_SOURCE_ID);
      expect(dem).toHaveLength(1);
      expect(dem[0].plan.perZoom.map((level) => level.z)).toEqual([
        TERRARIUM.sampleZoom,
      ]);
    }
  });

  it("does not deepen the DEM when the detail rail moves", () => {
    const demAt = (zMax: number) =>
      planRegionForBasemaps(
        TEN_KM,
        ["six-base"],
        zMax,
        maxZoomFor,
      ).perSource.find((s) => s.basemapId === DEM_SOURCE_ID)!;
    expect(demAt(18).plan.totalTiles).toBe(demAt(12).plan.totalTiles);
    expect(demAt(18).size.p90Bytes).toBe(demAt(12).size.p90Bytes);
  });

  it("counts the DEM in the totals the caps and the space check read", () => {
    const job = planRegionForBasemaps(TEN_KM, ["six-topo"], 16, maxZoomFor);
    const dem = job.perSource.find((s) => s.basemapId === DEM_SOURCE_ID)!;
    expect(job.totalTiles).toBe(
      job.perSource.reduce((sum, s) => sum + s.plan.totalTiles, 0),
    );
    expect(job.p90Bytes).toBeGreaterThanOrEqual(dem.size.p90Bytes);
  });

  it("starts every pyramid at REGION_MIN_ZOOM so a zoomed-out offline map is not blank", () => {
    const job = planRegionForBasemaps(TEN_KM, ["six-topo"], 14, maxZoomFor);
    expect(job.perSource[0].plan.perZoom[0].z).toBe(REGION_MIN_ZOOM);
  });
});

// What a save cost before the figures moved onto the archives, measured from
// that code for three boxes in New South Wales (inside, the 40 km box and across
// its border) and three basemap choices: those rows must stay to the byte. The
// Perth and Victorian Alps rows are new expectations: outside it, only what the
// box's own tiles cost. Mutation: drop one NSW clip from `planRegionForBasemaps` (the slope, say)
// and the inside and border rows go red; clip NSW's archives for every box
// again and the outside rows go red.
describe("what a save costs, by the archives that cover its box", () => {
  const ids = {
    none: [],
    topo: ["six-topo"],
    all: ["six-topo", "six-base", "six-imagery"],
  } as const;
  const maxZoomFor = (id: string) =>
    ({ "six-topo": 16, "six-base": 18, "six-imagery": 18 })[id]!;
  const cost = (box: RegionBbox, which: keyof typeof ids) => {
    const job = planRegionForBasemaps(box, [...ids[which]], 17, maxZoomFor);
    return [job.meanBytes, job.p90Bytes, job.totalTiles, job.seconds];
  };

  const INSIDE = TEN_KM;
  const BLUE_MOUNTAINS_40_KM = {
    west: 150.05,
    south: -33.95,
    east: 150.5,
    north: -33.55,
  };
  // Two corners in Victoria, across the Murray from Albury.
  const ACROSS_BORDER = {
    west: 146.85,
    south: -36.3,
    east: 147.05,
    north: -36.15,
  };
  const PERTH = { west: 115.8, south: -32.0, east: 115.9, north: -31.9 };
  // The Victorian Alps: inside the height archive's box, outside NSW's border.
  const VICTORIAN_ALPS = {
    west: 146.0,
    south: -37.2,
    east: 146.1,
    north: -37.1,
  };

  it.each([
    ["inside NSW", "none", INSIDE, [13_222_297, 17_837_433, 9, 3]],
    ["inside NSW", "topo", INSIDE, [25_052_493, 35_611_765, 629, 210]],
    ["inside NSW", "all", INSIDE, [103_419_819, 139_675_896, 5231, 1744]],
    [
      "a 40 km box in the Blue Mountains",
      "none",
      BLUE_MOUNTAINS_40_KM,
      [178_903_827, 237_371_346, 132, 44],
    ],
    [
      "a 40 km box in the Blue Mountains",
      "topo",
      BLUE_MOUNTAINS_40_KM,
      [370_595_289, 527_154_577, 10_117, 3373],
    ],
    [
      "a 40 km box in the Blue Mountains",
      "all",
      BLUE_MOUNTAINS_40_KM,
      [1_685_931_572, 2_276_367_514, 88_167, 29_389],
    ],
    [
      "across NSW's border",
      "none",
      ACROSS_BORDER,
      [35_295_924, 47_008_242, 30, 10],
    ],
    [
      "across NSW's border",
      "topo",
      ACROSS_BORDER,
      [69_522_119, 98_594_391, 1818, 606],
    ],
    [
      "across NSW's border",
      "all",
      ACROSS_BORDER,
      [302_863_872, 408_758_584, 15_606, 5202],
    ],
  ] as const)(
    "costs %s with %s maps as it did before",
    (_name, which, box, figures) => {
      expect(cost(box, which)).toEqual(figures);
    },
  );

  // Mutation: clip NSW's archives for every box, as the estimate did, and a
  // save outside New South Wales is priced for archives it will not cut.
  it.each([
    ["Perth", "none", PERTH, [443_330, 489_777, 12, 4]],
    ["Perth", "topo", PERTH, [12_147_523, 18_090_081, 625, 209]],
    ["Perth", "all", PERTH, [88_576_708, 119_540_702, 5107, 1703]],
    ["the Victorian Alps", "none", VICTORIAN_ALPS, [443_330, 489_777, 12, 4]],
    [
      "the Victorian Alps",
      "topo",
      VICTORIAN_ALPS,
      [12_694_149, 18_885_968, 655, 219],
    ],
    [
      "the Victorian Alps",
      "all",
      VICTORIAN_ALPS,
      [95_416_085, 128_712_616, 5513, 1838],
    ],
  ] as const)(
    "costs %s with %s maps for its own tiles and the worldwide heights only",
    (_name, which, box, figures) => {
      expect(cost(box, which)).toEqual(figures);
    },
  );
});
