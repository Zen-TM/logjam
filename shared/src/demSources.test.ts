import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DEM_SOURCES,
  TERRARIUM,
  demCredits,
  demTileUrl,
  sampleDem,
  type DemSource,
  type DemTileReader,
} from "./demSources.js";
import { DEM_TILE_SIZE } from "./demTiles.js";
import { buildElevationProfile } from "./elevation.js";

describe("demTileUrl", () => {
  // The decode fixture is a REAL terrarium tile named for its address: z13,
  // x=7516, y=4911 (Blue Gum Forest / Grose Valley). That makes it the one
  // address whose correct URL is independently known.
  it("addresses the tile the committed decode fixture came from", () => {
    expect(demTileUrl(TERRARIUM, 7516, 4911)).toBe(
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/7516/4911.png",
    );
  });

  it("uses the XYZ row, not the TMS row an MBTiles store flips to", () => {
    // Silent failure guard: the TMS row at z13 (8191 - 4911 = 3280) is also a
    // real tile, so the wrong one returns heights rather than an error.
    expect(demTileUrl(TERRARIUM, 7516, 4911)).not.toContain("3280");
  });
});

describe("the declaration", () => {
  it("ends in a worldwide source, so the walk always has a last resort", () => {
    expect(DEM_SOURCES.at(-1)!.coverage).toBeNull();
  });

  // Mutation: give a source both a tile set and an archive, or neither, and
  // each reader has to guess which one to read.
  it("serves each source one way: a public tile set or an archive", () => {
    for (const source of DEM_SOURCES)
      expect(
        (source.urlTemplate == null) !== (source.archivePath == null),
        source.id,
      ).toBe(true);
  });

  it("credits only the sources a result was read from", () => {
    expect(demCredits(["terrarium"])).toEqual([TERRARIUM.credit]);
    expect(demCredits([])).toEqual([]);
  });

  // Mutation: paste a source's host into a reader instead of importing the
  // declaration, and this names the file.
  it("is the only place a DEM host is written", () => {
    const prefixes = DEM_SOURCES.map(
      (s) => s.archivePath ?? s.urlTemplate!.split("{")[0]!,
    );
    const offenders: string[] = [];
    for (const pkg of ["api", "frontend", "mobile", "shared"]) {
      const root = join(import.meta.dirname, "../..", pkg, "src");
      for (const file of readdirSync(root, { recursive: true }) as string[]) {
        if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
        if (file.endsWith("demSources.ts")) continue;
        const text = readFileSync(join(root, file), "utf8");
        if (prefixes.some((prefix) => text.includes(prefix)))
          offenders.push(`${pkg}/src/${file}`);
      }
    }
    expect(
      offenders,
      "read a DEM source's URL from DEM_SOURCES (docs/decisions/0028)",
    ).toEqual([]);
  });
});

describe("sampleDem", () => {
  const ZOOM = 13;
  const TILE_X = 7516;
  const TILE_Y = 4911;
  const lonOfColumn = (column: number) =>
    ((TILE_X + column / DEM_TILE_SIZE) / 2 ** ZOOM) * 360 - 180;
  const LAT =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (TILE_Y + 0.5)) / 2 ** ZOOM))) *
      180) /
    Math.PI;
  /** A position on the centre of pixel `column`, where a height is exact. */
  const at = (column: number) => ({
    lon: lonOfColumn(column + 0.5),
    lat: LAT,
    distanceM: column * 19,
  });

  /** A source whose height is `base + slope * column`, over [from, to). */
  function source(
    id: string,
    base: number,
    slope: number,
    columns: [from: number, to: number] | null,
  ): DemSource & { tile: Float32Array } {
    return {
      ...TERRARIUM,
      id,
      coverage: columns && [
        lonOfColumn(columns[0]),
        -90,
        lonOfColumn(columns[1]),
        90,
      ],
      tile: new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE).map(
        (_, i) => base + slope * (i % DEM_TILE_SIZE),
      ),
    };
  }
  const reader: DemTileReader = async (src, tiles) =>
    new Map(
      tiles.map((t) => [
        `${t.tileX}/${t.tileY}`,
        (src as ReturnType<typeof source>).tile,
      ]),
    );

  const fine = source("fine", 1000, 1, [0, 100]);
  // 10 m higher everywhere: tree canopy against bare earth.
  const coarse = source("coarse", 1010, 1, null);

  it("gives every position the finest source that has it", async () => {
    const dem = await sampleDem([at(98), at(99), at(100)], reader, [
      fine,
      coarse,
    ]);
    expect(dem.heights).toEqual([1098, 1099, 1110]);
    expect(dem.sourceIds).toEqual(["fine", "fine", "coarse"]);
  });

  it("does not ask a source for tiles outside its coverage", async () => {
    const spy = vi.fn(reader);
    await sampleDem([at(150)], spy, [fine, coarse]);
    expect(spy.mock.calls.map(([src]) => src.id)).toEqual(["coarse"]);
  });

  it("falls through on a missing tile inside the coverage", async () => {
    const holed: DemTileReader = async (src, tiles) =>
      src.id === "fine" ? new Map() : reader(src, tiles);
    const dem = await sampleDem([at(50)], holed, [fine, coarse]);
    expect(dem.sourceIds).toEqual(["coarse"]);
  });

  // Mutation: sum climb from `heights` and the 10 m canopy offset at the join
  // is counted as an 11 m climb on a 1 m rise.
  it("measures the step across a seam in one source", async () => {
    const positions = [at(98), at(99), at(100), at(101)];
    const dem = await sampleDem(positions, reader, [fine, coarse]);
    expect(dem.heights).toEqual([1098, 1099, 1110, 1111]);
    expect(dem.levelled).toEqual([1098, 1099, 1100, 1101]);
    const profile = buildElevationProfile(positions, dem);
    expect(profile.gainM).toBe(0); // 3 m, under the 5 m hysteresis
    expect(profile.maxM).toBe(1111); // the chart shows heights as read
    expect(profile.demSourceIds).toEqual([]); // neither is a declared source
  });

  // Mutation: read the seam from the coarser of the two sources only. It has
  // no height at column 99, so the 2 m step would be dropped.
  it("walks on to a source under both when two footprints only touch", async () => {
    const left = source("left", 1000, 1, [0, 100]);
    const right = source("right", 2000, 1, [100, 200]);
    const under = source("under", 0, 2, null);
    const dem = await sampleDem([at(99), at(100)], reader, [
      left,
      right,
      under,
    ]);
    expect(dem.heights).toEqual([1099, 2100]);
    expect(dem.levelled).toEqual([1099, 1101]);
  });

  // Mutation: start the step at the raw difference between the two heights
  // instead of 0, and the 1001 m jump between unrelated surfaces is climbed.
  it("does not count the step when no source has both points", async () => {
    const left = source("left", 1000, 1, [0, 100]);
    const right = source("right", 2000, 1, [100, 200]);
    const dem = await sampleDem([at(99), at(100), at(101)], reader, [
      left,
      right,
    ]);
    expect(dem.levelled).toEqual([1099, 1099, 1100]);
  });

  // Mutation: forget the last known sample at a null, so the next one starts
  // a fresh run, and the join across the gap is left in `levelled`.
  it("treats a gap between two sources as a seam too", async () => {
    const left = source("left", 1000, 1, [0, 100]);
    const right = source("right", 2000, 1, [110, 200]);
    const dem = await sampleDem([at(99), at(105), at(110)], reader, [
      left,
      right,
    ]);
    expect(dem.heights).toEqual([1099, null, 2110]);
    expect(dem.levelled).toEqual([1099, null, 1099]);
  });

  it("leaves heights untouched when one source answers throughout", async () => {
    const dem = await sampleDem([at(1), at(2)], reader, [coarse]);
    expect(dem.levelled).toEqual(dem.heights);
  });
});
