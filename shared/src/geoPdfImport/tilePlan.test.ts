import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseGeoPdfGeoref } from "./parseGeoref";
import { buildGeoTransform, type GeoTransform, type XY } from "./transform";
import { buildTilePlan } from "./tilePlan";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, "__fixtures__", name)));

const bboxClip = (t: { x0: number; y0: number; x1: number; y1: number }): XY[] => [
  { x: t.x0, y: t.y0 },
  { x: t.x1, y: t.y0 },
  { x: t.x1, y: t.y1 },
  { x: t.x0, y: t.y1 },
];

async function logjamPlan() {
  const parsed = await parseGeoPdfGeoref(fixture("logjam-a5.pdf"));
  const vp = parsed.pages[0].viewports[0];
  const transform = buildGeoTransform(vp);
  return { transform, plan: buildTilePlan(transform, bboxClip(vp.bboxPt)) };
}

async function gdalPlan() {
  const parsed = await parseGeoPdfGeoref(fixture("gdal-mga56.pdf"));
  const vp = parsed.pages[0].viewports[0];
  const transform = buildGeoTransform(vp);
  const clip = vp.boundsPolygonPt ?? bboxClip(vp.bboxPt);
  return { transform, plan: buildTilePlan(transform, clip) };
}

describe("buildTilePlan — Logjam A5 fixture (affine fast path)", () => {
  it("derives a stable zoom range for a ~10 km 1:25k-style map", async () => {
    const { plan } = await logjamPlan();
    // A5 landscape, 0.1° × 0.1° extent. NOTE: the fixture squeezes a
    // taller-than-wide mercator extent into a landscape box, so page pts are
    // anisotropic — √|det J| ≈ 41 merc-m/pt → ~8.2 m/px source → zMax 13
    // (snapshot; a real generator export keeps aspect and would land at 14).
    expect(plan.zMax).toBe(13);
    // Coarsest level where the ~13.4 km mercator span fits in ≤ 2×2 tiles.
    expect(plan.zMin).toBe(12);
    expect(plan.tileSize).toBe(512);
  });

  it("emits affine warps only (Web Mercator plane + affine transform)", async () => {
    const { plan } = await logjamPlan();
    expect(plan.tiles.length).toBeGreaterThan(0);
    for (const tile of plan.tiles) {
      expect(tile.z).toBe(plan.zMax);
      expect(tile.warp.kind).toBe("affine");
    }
  });

  it("affine warp maps page points onto the correct tile pixels", async () => {
    const { transform, plan } = await logjamPlan();
    const tile = plan.tiles[0];
    if (tile.warp.kind !== "affine") throw new Error("expected affine warp");
    const [a, b, c, d, e, f] = tile.warp.m;
    // Probe: centre of the tile's page-space window.
    const p = {
      x: (tile.srcRect.x0 + tile.srcRect.x1) / 2,
      y: (tile.srcRect.y0 + tile.srcRect.y1) / 2,
    };
    const viaWarp = { x: a * p.x + b * p.y + c, y: d * p.x + e * p.y + f };
    // Independent path: pageToMercator → tile-pixel arithmetic.
    const m = transform.pageToMercator(p);
    const ORIGIN_SHIFT = 20037508.342789244;
    const tileSpan = (2 * ORIGIN_SHIFT) / 2 ** tile.z;
    const exact = {
      x: ((m.x - (-ORIGIN_SHIFT + tile.x * tileSpan)) / tileSpan) * 512,
      y: ((ORIGIN_SHIFT - tile.y * tileSpan - m.y) / tileSpan) * 512,
    };
    expect(Math.abs(viaWarp.x - exact.x)).toBeLessThan(1e-6);
    expect(Math.abs(viaWarp.y - exact.y)).toBeLessThan(1e-6);
  });

  it("is deterministic", async () => {
    const a = await logjamPlan();
    const b = await logjamPlan();
    expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
  });

  it("tile grid is XYZ-oriented (y grows southward)", async () => {
    const { transform, plan } = await logjamPlan();
    // The page-space top edge (north) must fall in the min-y tile row.
    const minY = Math.min(...plan.tiles.map((t) => t.y));
    const maxY = Math.max(...plan.tiles.map((t) => t.y));
    expect(minY).toBeLessThanOrEqual(maxY);
    const northMerc = transform.pageToMercator({ x: 210, y: 270 });
    const southMerc = transform.pageToMercator({ x: 210, y: 28 });
    expect(northMerc.y).toBeGreaterThan(southMerc.y);
  });
});

describe("buildTilePlan — GDAL MGA fixture (mesh path)", () => {
  it("emits mesh warps for a non-Mercator plane", async () => {
    const { plan } = await gdalPlan();
    expect(plan.tiles.length).toBeGreaterThan(0);
    for (const tile of plan.tiles) {
      expect(tile.warp.kind).toBe("mesh");
      if (tile.warp.kind === "mesh") {
        expect(tile.warp.grid).toBe(4);
        expect(tile.warp.dst).toHaveLength(2 * 5 * 5);
      }
    }
  });

  it("mesh interpolation deviates < 0.1 px from the exact mapping", async () => {
    const { transform, plan } = await gdalPlan();
    const ORIGIN_SHIFT = 20037508.342789244;
    for (const tile of plan.tiles) {
      if (tile.warp.kind !== "mesh") throw new Error("expected mesh warp");
      const { grid, srcRect, dst } = tile.warp;
      const tileSpan = (2 * ORIGIN_SHIFT) / 2 ** tile.z;
      const exactTilePx = (p: XY) => {
        const m = transform.pageToMercator(p);
        return {
          x: ((m.x - (-ORIGIN_SHIFT + tile.x * tileSpan)) / tileSpan) * 512,
          y: ((ORIGIN_SHIFT - tile.y * tileSpan - m.y) / tileSpan) * 512,
        };
      };
      // Bilinear-interpolate the mesh at interior probe points.
      const interp = (u: number, v: number) => {
        const gx = u * grid;
        const gy = v * grid;
        const ix = Math.min(Math.floor(gx), grid - 1);
        const iy = Math.min(Math.floor(gy), grid - 1);
        const fx = gx - ix;
        const fy = gy - iy;
        const node = (r: number, c: number) => ({
          x: dst[2 * (r * (grid + 1) + c)],
          y: dst[2 * (r * (grid + 1) + c) + 1],
        });
        const n00 = node(iy, ix);
        const n01 = node(iy, ix + 1);
        const n10 = node(iy + 1, ix);
        const n11 = node(iy + 1, ix + 1);
        return {
          x:
            n00.x * (1 - fx) * (1 - fy) +
            n01.x * fx * (1 - fy) +
            n10.x * (1 - fx) * fy +
            n11.x * fx * fy,
          y:
            n00.y * (1 - fx) * (1 - fy) +
            n01.y * fx * (1 - fy) +
            n10.y * (1 - fx) * fy +
            n11.y * fx * fy,
        };
      };
      for (const u of [0.1, 0.35, 0.6, 0.9]) {
        for (const v of [0.15, 0.5, 0.85]) {
          const p = {
            x: srcRect.x0 + u * (srcRect.x1 - srcRect.x0),
            y: srcRect.y0 + v * (srcRect.y1 - srcRect.y0),
          };
          const exact = exactTilePx(p);
          const meshed = interp(u, v);
          expect(Math.abs(meshed.x - exact.x)).toBeLessThan(0.1);
          expect(Math.abs(meshed.y - exact.y)).toBeLessThan(0.1);
        }
      }
    }
  });

  it("clip filtering drops tiles fully outside the neatline", async () => {
    const parsed = await parseGeoPdfGeoref(fixture("gdal-mga56.pdf"));
    const vp = parsed.pages[0].viewports[0];
    const transform = buildGeoTransform(vp);
    const full = buildTilePlan(transform, bboxClip(vp.bboxPt));
    // Clip to the bottom-left quadrant of the page only.
    const midX = (vp.bboxPt.x0 + vp.bboxPt.x1) / 2;
    const midY = (vp.bboxPt.y0 + vp.bboxPt.y1) / 2;
    const quadrant = buildTilePlan(
      transform,
      bboxClip({ x0: vp.bboxPt.x0, y0: vp.bboxPt.y0, x1: midX, y1: midY }),
    );
    expect(quadrant.tiles.length).toBeLessThanOrEqual(full.tiles.length);
    const fullKeys = new Set(full.tiles.map((t) => `${t.z}/${t.x}/${t.y}`));
    for (const tile of quadrant.tiles) {
      expect(fullKeys.has(`${tile.z}/${tile.x}/${tile.y}`)).toBe(true);
    }
  });
});

describe("buildTilePlan — estimate", () => {
  it("estimates base tiles + third for the pyramid", async () => {
    const { plan } = await logjamPlan();
    expect(plan.estimatedTotalTiles).toBe(Math.ceil((plan.tiles.length * 4) / 3));
  });
});
