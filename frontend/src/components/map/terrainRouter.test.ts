import type { SharpenedOverlay } from "@logjam/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

// Each archive the router opens answers from this table: url → zoom → tile.
const held = vi.hoisted(() => new Map<string, Set<number>>());
vi.mock("pmtiles", () => ({
  PMTiles: class {
    constructor(private url: string) {}
    async getZxy(z: number) {
      return held.get(this.url)?.has(z)
        ? { data: new TextEncoder().encode(`${this.url}@${z}`).buffer }
        : undefined;
    }
  },
}));

import {
  areasKey,
  isAbsentTerrainTile,
  setRoutedAreas,
  terrainTile,
  terrainTileTemplate,
} from "./terrainRouter";
import { TERRAIN_ENTRIES, terrainEntries } from "./terrainEntries";

// A made-up area: z15 tiles 30100–30103 × 19654–19657, to z16.
const area: SharpenedOverlay = {
  id: "a1",
  zmax: 16,
  tiles15: [30100, 19654, 30103, 19657],
  coverage: [150.7, -33.8, 150.72, -33.78],
  contours: true,
  credit: "Elevation: a survey <made up> & credited.",
  createdAt: "2026-10-24T00:00:00.000Z",
  heightsUrl: "https://bucket.test/h?sig",
  slopeUrl: "https://bucket.test/s?sig",
  contoursUrl: "https://bucket.test/c?sig",
};
const statewide = (path: string) => `${window.location.origin}/${path}`;
const SLOPE = statewide("master/dem/nsw-5m-slope.pmtiles");

const read = async (layer: string, z: number, x: number, y: number) => {
  const { data } = await terrainTile(
    {
      url: terrainTileTemplate(layer as "slope", [area]).replace(
        "{z}/{x}/{y}",
        `${z}/${x}/${y}`,
      ),
    },
    new AbortController(),
  );
  return new TextDecoder().decode(data);
};

afterEach(() => {
  held.clear();
  setRoutedAreas([]);
});

describe("the terrain router", () => {
  // Mutations: answer an absent tile with null data (MapLibre then leaves it
  // loading for good: no parent drawn, no idle), or with the statewide tile
  // (the halo returns).
  it("throws for a tile no archive holds, so the parent is drawn", async () => {
    setRoutedAreas([area]);
    held.set(area.slopeUrl, new Set([15, 16]));
    held.set(SLOPE, new Set([15]));
    const absent = read("slope", 16, 30099 * 2, 19654 * 2);
    await expect(absent).rejects.toSatisfy(isAbsentTerrainTile);
    // As MapLibre may hand it on: a copy with the message alone.
    expect(isAbsentTerrainTile({ message: "absent terrain tile" })).toBe(true);
    expect(isAbsentTerrainTile(new Error("Bad response code: 404"))).toBe(
      false,
    );
  });

  // Mutations: read an area's tile from the statewide archive, or the
  // hillshade from the slope archive.
  it("reads each tile from the one archive the rule names", async () => {
    setRoutedAreas([area]);
    held.set(area.slopeUrl, new Set([15, 16]));
    held.set(area.heightsUrl, new Set([16]));
    held.set(SLOPE, new Set([14, 15]));
    expect(await read("slope", 14, 15050, 9827)).toBe(`${SLOPE}@14`);
    expect(await read("slope", 15, 30100, 19654)).toBe(`${area.slopeUrl}@15`);
    expect(await read("slope", 15, 30099, 19654)).toBe(`${SLOPE}@15`);
    expect(await read("hillshade", 16, 60200, 39308)).toBe(
      `${area.heightsUrl}@16`,
    );
  });

  // Mutation: an empty raster tile handed back as data, which MapLibre
  // cannot decode; a missing contour tile thrown, which draws the parent's
  // lines over a place the area says has none.
  it("leaves a missing raster tile to its parent and empties a vector one", async () => {
    setRoutedAreas([area]);
    held.set(area.contoursUrl!, new Set());
    await expect(read("slope", 15, 30100, 19654)).rejects.toSatisfy(
      isAbsentTerrainTile,
    );
    expect(await read("contours", 14, 15050, 9827)).toBe("");
  });

  // Mutation: key the set on the URLs, and every 24 h refresh of them
  // rebuilds the map's terrain sources.
  it("keys a set of areas on what changes the tiles, not on its URLs", () => {
    const fresh = { ...area, slopeUrl: "https://bucket.test/s?new" };
    expect(areasKey([fresh])).toBe(areasKey([area]));
    expect(areasKey([area, { ...area, id: "a2" }])).toBe(
      areasKey([{ ...area, id: "a2" }, area]),
    );
    expect(areasKey([{ ...area, zmax: 17 }])).not.toBe(areasKey([area]));
  });
});

describe("terrainEntries", () => {
  // Mutation: route every user's terrain, and a user with no area reads
  // every Terrain tile through the router for nothing.
  it("keeps today's entries for a user with no area", () => {
    expect(terrainEntries([])).toBe(TERRAIN_ENTRIES);
  });

  // Mutations: a routed source that stops at z15 (the area's z16 is never
  // asked for), contours past z14, or the survey's credit left out.
  it("routes each layer to the deepest zoom an area holds, crediting it", () => {
    const entries = terrainEntries([area, { ...area, id: "a2", zmax: 17 }]);
    expect(entries.slope.tiles).toMatchObject({ minzoom: 8, maxzoom: 17 });
    expect(entries.hillshade.tiles?.maxzoom).toBe(17);
    expect(entries.contours.tiles).toMatchObject({ minzoom: 11, maxzoom: 14 });
    expect(entries.slope.id).toBe(TERRAIN_ENTRIES.slope.id);
    expect(entries.slope.attribution).toContain(
      "a survey &lt;made up&gt; &amp; credited.",
    );
  });
});
