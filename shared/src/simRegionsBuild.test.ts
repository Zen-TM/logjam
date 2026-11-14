// scripts/sim-regions/boxes.json says where the build writes each simulated
// region's archives; simRegions.ts says where the clients read them. Two lists
// that must agree, held equal here, so a path renamed on one side does not
// leave the dev stack serving a 404 for a layer that was built.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PMTiles, type Source } from "pmtiles";
import { describe, expect, it } from "vitest";
import { SIM_NZ, SIM_UTAH, SIM_WORLD } from "./simRegions.js";

type Box = [number, number, number, number];
type Shape = { path: string; fixtureZooms: [number, number] };
interface Built {
  boxes: Box[];
  heights: Shape & { zmax: number; zmin: number; credit: string };
  slope?: Shape;
  contours?: Shape;
  vector: Shape & { maxzoom: number };
  fixture: { bbox: Box };
}

const boxes = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../scripts/sim-regions/boxes.json"),
    "utf8",
  ),
).regions as Record<string, Built>;

const DECLARED: Record<string, Record<string, string | undefined>> = {
  simnz: {
    heights: SIM_NZ.terrain.heights?.archivePath,
    slope: SIM_NZ.terrain.slope?.archivePath,
    contours: SIM_NZ.terrain.contours?.archivePath,
    vector: SIM_NZ.vector?.archivePath,
  },
  simutah: {
    heights: SIM_UTAH.terrain.heights?.archivePath,
    slope: SIM_UTAH.terrain.slope?.archivePath,
    contours: SIM_UTAH.terrain.contours?.archivePath,
    vector: SIM_UTAH.vector?.archivePath,
  },
  world: {
    heights: SIM_WORLD.terrain.heights?.archivePath,
    vector: SIM_WORLD.vector?.archivePath,
  },
};

describe("scripts/sim-regions/boxes.json", () => {
  it("names the regions simRegions.ts declares, and no others", () => {
    // Mutation: add a fourth region to boxes.json, or drop "world" from it.
    expect(Object.keys(boxes).sort()).toEqual(Object.keys(DECLARED).sort());
  });

  it.each(Object.keys(DECLARED))(
    "builds %s's archives at the paths simRegions.ts declares",
    (id) => {
      // Mutation: rename "master/dem/simnz-slope.pmtiles" in boxes.json (or in
      // simRegions.ts) so the two differ.
      const built = boxes[id] as unknown as Record<string, { path: string }>;
      const checked = Object.entries(DECLARED[id]).map(([kind, declared]) => {
        expect(built[kind]?.path, `${id} ${kind}`).toBe(declared);
        return kind;
      });
      // A floor: a region with no archive to compare checks nothing.
      expect(checked.length).toBeGreaterThanOrEqual(2);
      // Every archive boxes.json builds is one the region declares.
      const buildsPath = (k: string) =>
        built[k] && typeof built[k].path === "string";
      expect(
        ["heights", "slope", "contours", "vector"].filter(buildsPath).sort(),
      ).toEqual(checked.sort());
    },
  );

  it.each(Object.keys(DECLARED))("has well-formed boxes for %s", (id) => {
    // Mutation: swap a box's west and east, give a heights credit of "", move
    // the fixture box outside the boxes, or widen it across a tile edge.
    const { boxes: bs, heights } = boxes[id];
    expect(bs.length).toBeGreaterThan(0);
    for (const [west, south, east, north] of bs) {
      expect(west).toBeLessThan(east);
      expect(south).toBeLessThan(north);
      expect(Math.abs(west)).toBeLessThanOrEqual(180);
      expect(Math.abs(south)).toBeLessThanOrEqual(85);
    }
    expect(heights.zmax).toBeGreaterThan(heights.zmin);
    // The fixture box lies inside one of the boxes it is cut from.
    const [fw, fs, fe, fn] = boxes[id].fixture.bbox;
    expect(
      bs.some(([w, s, e, n]) => w <= fw && fe <= e && s <= fs && fn <= n),
    ).toBe(true);
    // One tile at every zoom it names: the box lies inside one tile of the
    // deepest zoom of any archive, and so inside one tile of each coarser.
    const deepest = Math.max(
      ...(["heights", "slope", "contours", "vector"] as const).flatMap(
        (kind) => boxes[id][kind]?.fixtureZooms.slice(1) ?? [],
      ),
    );
    const tileAt = (lon: number, lat: number) => {
      const n = 2 ** deepest;
      const rad = (lat * Math.PI) / 180;
      return [
        Math.floor(((lon + 180) / 360) * n),
        Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n),
      ];
    };
    expect(tileAt(fw, fn), `${id} fixture box corners`).toEqual(tileAt(fe, fs));
    for (const kind of ["heights", "slope", "contours", "vector"] as const) {
      const zooms = boxes[id][kind]?.fixtureZooms;
      if (zooms)
        expect(zooms[0], `${id} ${kind}`).toBeLessThanOrEqual(zooms[1]);
    }
    expect(heights.fixtureZooms[1]).toBeLessThanOrEqual(heights.zmax);
    expect(heights.fixtureZooms[0]).toBeGreaterThanOrEqual(heights.zmin);
    expect(heights.credit.length).toBeGreaterThan(40);
  });

  it("sends a user agent that names no project or person", () => {
    // Mutation: set BROWSER_AGENT in build.py to "logjam-sim-regions/1".
    const script = readFileSync(
      join(import.meta.dirname, "../../scripts/sim-regions/build.py"),
      "utf8",
    );
    const agent = /^BROWSER_AGENT = "(.*)"$/m.exec(script)?.[1];
    expect(agent, "no BROWSER_AGENT line in build.py").toBeDefined();
    expect(agent).toMatch(/^Mozilla\/5\.0 /);
    expect(agent).not.toMatch(/logjam|zen/i);
    // Both requests build.py makes itself send it; a third header with another
    // value would go unchecked.
    expect(script.match(/User-Agent/g)).toHaveLength(2);
  });

  it("has one small PMTiles fixture for every archive it builds, and no other", () => {
    // Mutation: delete one file from __fixtures__/sim-regions/, add a stray
    // one, or overwrite one with text.
    const dir = join(import.meta.dirname, "__fixtures__/sim-regions");
    const wanted = Object.values(boxes).flatMap((region) =>
      (["heights", "slope", "contours", "vector"] as const)
        .map((kind) => region[kind]?.path)
        .filter((path): path is string => path !== undefined)
        .map((path) => path.split("/").pop() as string),
    );
    // A floor: ten archives are built, so ten fixtures are expected.
    expect(wanted.length).toBeGreaterThanOrEqual(10);
    expect(readdirSync(dir).sort()).toEqual(wanted.sort());
    for (const name of wanted) {
      const bytes = readFileSync(join(dir, name));
      expect(bytes.subarray(0, 7).toString("latin1"), name).toBe("PMTiles");
      expect(bytes.length, name).toBeLessThan(300_000);
    }
  });

  it("keeps each fixture's metadata to what its header says, and its credit", async () => {
    // Mutation: `pmtiles edit` a fixture's metadata to maxzoom 17 (its header
    // says 15), or to a description that is empty, or that names no source.
    const dir = join(import.meta.dirname, "__fixtures__/sim-regions");
    const contours = new Set(
      Object.values(boxes).flatMap((r) =>
        r.contours ? [r.contours.path.split("/").pop()] : [],
      ),
    );
    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const name of files) {
      const bytes = new Uint8Array(readFileSync(join(dir, name)));
      const source: Source = {
        getKey: () => name,
        getBytes: async (offset, length) => ({
          data: bytes.slice(offset, offset + length).buffer,
        }),
      };
      const archive = new PMTiles(source);
      const header = await archive.getHeader();
      const meta = (await archive.getMetadata()) as Record<string, string>;
      expect(Number(meta.minzoom), `${name} minzoom`).toBe(header.minZoom);
      expect(Number(meta.maxzoom), `${name} maxzoom`).toBe(header.maxZoom);
      const bounds = meta.bounds.split(",").map(Number);
      const fromHeader = [
        header.minLon,
        header.minLat,
        header.maxLon,
        header.maxLat,
      ];
      fromHeader.forEach((v, i) =>
        expect(bounds[i], `${name} bounds`).toBeCloseTo(v, 5),
      );
      // The credit travels with the fixture: contours keep it in `description`
      // (as the contours builder writes it), every other archive in
      // `attribution`, and it names where the data is from.
      const credit = contours.has(name) ? meta.description : meta.attribution;
      expect(credit, `${name} credit`).toMatch(
        /OpenStreetMap|Land Information New Zealand|Geological Survey|COPERNICUS/,
      );
    }
  });
});
