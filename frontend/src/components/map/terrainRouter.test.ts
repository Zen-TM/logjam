import type { SharpenedOverlay } from "@logjam/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

// Each archive the router opens answers from this table: url → zoom → tile.
// One in `failing` rejects instead, as an expired or deleted URL does.
const held = vi.hoisted(() => new Map<string, Set<number>>());
const failing = vi.hoisted(() => new Map<string, Error>());
vi.mock("pmtiles", () => ({
  PMTiles: class {
    url: string;
    constructor(url: string) {
      this.url = url;
    }
    async getZxy(z: number) {
      const failure = failing.get(this.url);
      if (failure) throw failure;
      return held.get(this.url)?.has(z)
        ? { data: new TextEncoder().encode(`${this.url}@${z}`).buffer }
        : undefined;
    }
  },
}));

import {
  areasKey,
  isAbsentTerrainTile,
  routedAttribution,
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
  failing.clear();
  setRoutedAreas([]);
});

describe("the terrain router", () => {
  // Mutations: answer an absent tile with null data (MapLibre 6.14 then draws
  // an empty tile, not the parent), or with the statewide tile (the halo
  // returns).
  it("throws for a tile no archive holds, so the parent is drawn", async () => {
    setRoutedAreas([area]);
    held.set(area.slopeUrl, new Set([15, 16]));
    // The statewide archive has this z16 tile: a router that answered it
    // would draw it, so only the throw passes.
    held.set(SLOPE, new Set([15, 16]));
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

  // Mutation: let an area archive's failure through, and the map's handler
  // reads "Bad response code: 403" as a dead source: it tears down the whole
  // statewide Terrain layer it shares an id with, for the session.
  it("draws past an area archive that fails, but lets an abort through", async () => {
    setRoutedAreas([area]);
    failing.set(area.slopeUrl, new Error("Bad response code: 403"));
    await expect(read("slope", 15, 30100, 19654)).rejects.toSatisfy(
      isAbsentTerrainTile,
    );
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    failing.set(area.slopeUrl, abort);
    await expect(read("slope", 15, 30100, 19654)).rejects.toBe(abort);
  });

  // Mutation: a statewide path in the router that differs from the entry's,
  // and a user who gains an area sees another statewide archive below z15.
  it("reads the statewide archive the entries do", async () => {
    setRoutedAreas([area]);
    for (const key of ["contours", "slope", "hillshade"] as const) {
      const url = TERRAIN_ENTRIES[key].pmtilesUrl;
      held.set(url, new Set([13]));
      expect(await read(key, 13, 7525, 4913)).toBe(`${url}@13`);
    }
  });

  // Mutation: swallow a statewide archive's failure too, and a statewide
  // archive that is gone draws a blank layer the map never flags.
  it("lets a statewide archive's failure through", async () => {
    setRoutedAreas([area]);
    failing.set(SLOPE, new Error("Bad response code: 404"));
    await expect(read("slope", 14, 15050, 9827)).rejects.toThrow(
      "Bad response code: 404",
    );
  });

  // Mutation: log the URL or the tile on any path, and a coarse location or
  // a bearer credential reaches the console.
  it("logs nothing", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (level) => vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const noContours = { ...area, id: "a9", contoursUrl: null };
    const quiet = (tile: Promise<unknown>) => tile.catch(() => {});
    // Read: an area's tile and a statewide one, both holding data.
    setRoutedAreas([area]);
    held.set(area.slopeUrl, new Set([15]));
    held.set(SLOPE, new Set([14]));
    await read("slope", 15, 30100, 19654);
    await read("slope", 14, 15050, 9827);
    // Absent: past zmax, a missing raster tile, an empty contour tile.
    held.set(area.contoursUrl!, new Set());
    await quiet(read("slope", 17, 120400, 78616));
    await quiet(read("hillshade", 16, 60200, 39308));
    await read("contours", 14, 15050, 9827);
    // An area with contours and no URL for them.
    setRoutedAreas([noContours]);
    await quiet(read("contours", 14, 15050, 9827));
    // Failures: an area's, a statewide one, an abort.
    setRoutedAreas([area]);
    failing.set(area.slopeUrl, new Error("Bad response code: 404"));
    await quiet(read("slope", 15, 30100, 19654));
    failing.set(SLOPE, new Error("Bad response code: 403"));
    await quiet(read("slope", 14, 15050, 9827));
    failing.set(
      area.slopeUrl,
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    await quiet(read("slope", 15, 30100, 19654));
    // A URL that is not the router's.
    await quiet(
      terrainTile(
        { url: "logjam-terrain://nope/1/2/3" },
        new AbortController(),
      ),
    );
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
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

  // Mutation: one line per area, and two areas from the same month credit
  // the survey twice under every Terrain layer.
  it("credits each line once, for every visible area", () => {
    const other = { ...area, id: "a2", credit: "Elevation: another survey." };
    const credit = routedAttribution("Statewide.", [
      area,
      { ...area, id: "a3" },
      other,
    ]);
    expect(credit.split("credited.").length - 1).toBe(1);
    expect(credit).toContain("another survey.");
  });
});
