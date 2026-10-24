import { describe, expect, it } from "vitest";
import {
  TERRAIN_ROUTED_FROM,
  terrainTileArchive,
  type SharpenedArea,
} from "@logjam/shared";

import {
  terrainRoutes,
  tileRectBounds,
  type TerrainRoute,
} from "./terrainRoutes";

// Made-up areas: a 1 m one overlapping an older 2 m one (the 1 m one ranks
// first), a third beside the 2 m one on the same rows, and a fourth with no
// contour archive, away from them all.
const area = (
  id: string,
  zmax: 16 | 17,
  tiles15: [number, number, number, number],
  contours = true,
): SharpenedArea => ({
  id,
  zmax,
  tiles15,
  coverage: [0, 0, 0, 0],
  contours,
  credit: "Made-up credit",
  createdAt: "2026-10-01T00:00:00Z",
});
const FINE = area("fine", 17, [100, 200, 103, 203]);
const COARSE = area("coarse", 16, [102, 202, 105, 205]);
const BESIDE = area("beside", 16, [106, 202, 107, 205]);
const BARE = area("bare", 16, [300, 300, 301, 301], false);
const AREAS = [COARSE, BARE, BESIDE, FINE];

const holds = (route: TerrainRoute<SharpenedArea>, x: number, y: number) =>
  x >= route.tiles[0] &&
  x <= route.tiles[2] &&
  y >= route.tiles[1] &&
  y <= route.tiles[3];

describe("terrainRoutes", () => {
  for (const layer of ["heights", "slope", "contours"] as const) {
    // Red if a route widens across archives, or an area drops out of a layer.
    it(`gives each ${layer} tile the archive terrainTileArchive picks, from one route`, () => {
      const z = TERRAIN_ROUTED_FROM[layer];
      const shift = 15 - z;
      const routes = terrainRoutes(AREAS, layer);
      for (let x = (96 >> shift) - 1; x <= 306 >> shift; x++)
        for (let y = (196 >> shift) - 1; y <= 306 >> shift; y++) {
          const owners = routes.filter((r) => holds(r, x, y));
          expect(owners).toHaveLength(1);
          expect(owners[0].archive).toBe(
            terrainTileArchive(AREAS, layer, z, x, y),
          );
        }
    });

    // Red if terrainTileArchive routes from a zoom other than
    // TERRAIN_ROUTED_FROM, or an area's tiles are not its range's descendants.
    it(`draws each deeper ${layer} tile from its route's archive, larger past that archive's deepest zoom`, () => {
      const from = TERRAIN_ROUTED_FROM[layer];
      const shift = 15 - from;
      const routes = terrainRoutes(AREAS, layer);
      for (let z = from + 1; z <= 18; z++) {
        const s = 2 ** (z - from);
        for (let x = (98 >> shift) - 1; x <= 108 >> shift; x++)
          for (let y = (198 >> shift) - 1; y <= 208 >> shift; y++) {
            const [route] = routes.filter((r) => holds(r, x, y));
            const answer = terrainTileArchive(
              AREAS,
              layer,
              z,
              x * s + s - 1,
              y * s,
            );
            if (answer !== "absent") expect(route.archive).toBe(answer);
            // Absent: the route's archive stops above z, and MapLibre draws
            // its deepest tile larger, as Logjam Web draws the parent.
            else
              expect(
                route.archive === "statewide" || route.archive.zmax < z,
              ).toBe(true);
          }
      }
    });

    // Red if a route widens across archives (two routes then hold one tile).
    it(`covers the world at z${TERRAIN_ROUTED_FROM[layer]} with ${layer} routes that never overlap`, () => {
      const z = TERRAIN_ROUTED_FROM[layer];
      const routes = terrainRoutes(AREAS, layer);
      const size = ({ tiles: [x0, y0, x1, y1] }: TerrainRoute<SharpenedArea>) =>
        (x1 - x0 + 1) * (y1 - y0 + 1);
      expect(routes.reduce((sum, r) => sum + size(r), 0)).toBe(4 ** z);
      for (const a of routes)
        for (const b of routes)
          if (a !== b)
            expect(
              a.tiles[0] <= b.tiles[2] &&
                b.tiles[0] <= a.tiles[2] &&
                a.tiles[1] <= b.tiles[3] &&
                b.tiles[1] <= a.tiles[3],
            ).toBe(false);
    });
  }

  it("reads one statewide route when there are no areas", () => {
    expect(terrainRoutes([], "slope")).toEqual([
      { archive: "statewide", tiles: [0, 0, 2 ** 15 - 1, 2 ** 15 - 1] },
    ]);
  });

  it("gives an area with no contour archive the statewide contours", () => {
    const routes = terrainRoutes([BARE], "contours");
    expect(routes.every((r) => r.archive === "statewide")).toBe(true);
  });
});

describe("tileRectBounds", () => {
  // Back from degrees to tiles, as MapLibre does when it reads `bounds`.
  const tileX = (lon: number, z: number) =>
    Math.floor(((lon + 180) / 360) * 2 ** z);
  const tileY = (lat: number, z: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(
      ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z,
    );
  };

  // Red if the bounds are not drawn in: the neighbouring row is then inside.
  it("holds the rectangle's tiles and none of their neighbours, at every zoom to z17", () => {
    const rect = [30062, 19646, 30065, 19649] as const;
    const [west, south, east, north] = tileRectBounds(15, rect);
    for (let z = 15; z <= 17; z++) {
      const s = 2 ** (z - 15);
      expect(tileX(west, z)).toBe(rect[0] * s);
      expect(tileX(east, z)).toBe((rect[2] + 1) * s - 1);
      expect(tileY(north, z)).toBe(rect[1] * s);
      expect(tileY(south, z)).toBe((rect[3] + 1) * s - 1);
    }
  });
});
