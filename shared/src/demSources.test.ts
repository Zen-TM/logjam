import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  CLIMB_SOURCES,
  DEM_SOURCES,
  GPS_CLIMB_SOURCE,
  NSW_5M,
  SHARPENED_CLIMB_SOURCE,
  clearDemArchives,
  demArchive,
  readDemArchive,
  TERRARIUM,
  demCredits,
  demTileUrl,
  isFinerClimbSource,
  sampleDem,
  type DemSource,
  type DemTileReader,
} from "./demSources.js";
import { DEM_TILE_SIZE } from "./demTiles.js";
import { buildElevationProfile, densifyLineSegments } from "./elevation.js";
import { sharpenedDemSource } from "./sharpen.js";

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

  // Mutation: give a source two of a tile set, an archive and an area, or
  // none, and each reader has to guess which one to read.
  it("serves each source one way: a tile set, an archive or an area's", () => {
    const area = sharpenedDemSource({
      id: "a1",
      zmax: 16,
      tiles15: [0, 0, 1, 1],
      coverage: [150, -34, 150.01, -33.99],
      contours: true,
      credit: "Elevation: a survey.",
      createdAt: "2026-10-24T00:00:00.000Z",
    });
    for (const source of [...DEM_SOURCES, area])
      expect(
        [source.urlTemplate, source.archivePath, source.areaId].filter(
          (way) => way != null,
        ),
        source.id,
      ).toHaveLength(1);
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

describe("climb sources", () => {
  it("rank every DEM source above GPS heights, finest first", () => {
    expect(CLIMB_SOURCES).toEqual([
      SHARPENED_CLIMB_SOURCE,
      ...DEM_SOURCES.map((source) => source.id),
      GPS_CLIMB_SOURCE,
    ]);
    expect(isFinerClimbSource("lidar", "nsw-5m")).toBe(true);
    expect(isFinerClimbSource("nsw-5m", "lidar")).toBe(false);
    expect(isFinerClimbSource("nsw-5m", "terrarium")).toBe(true);
    expect(isFinerClimbSource("terrarium", "gps")).toBe(true);
    expect(isFinerClimbSource("terrarium", "nsw-5m")).toBe(false);
    expect(isFinerClimbSource("nsw-5m", "nsw-5m")).toBe(false);
    expect(isFinerClimbSource("gps", "gps")).toBe(false);
  });

  it("take a climb with no source beside it as GPS", () => {
    expect(isFinerClimbSource("terrarium", null)).toBe(true);
    expect(isFinerClimbSource("terrarium", undefined)).toBe(true);
  });

  it("never replace a climb from a source this build does not know", () => {
    expect(isFinerClimbSource("nsw-5m", "nsw-1m")).toBe(false);
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

  describe("a pause gap", () => {
    // A height here depends on the column only, so a line that runs north
    // along one column is level. Two of them: recorded at 1020 m, paused,
    // driven 190 m up the hill, resumed.
    const level = (column: number): [number, number][] => [
      [lonOfColumn(column + 0.5), LAT - 0.001],
      [lonOfColumn(column + 0.5), LAT + 0.001],
    ];
    const paused = [level(10), level(200)];

    // Mutation: drop the `gap` test in `sampleDem` and the 190 m between the
    // two segments is counted as climb nobody walked.
    it("is not counted as climb", async () => {
      const positions = densifyLineSegments(paused);
      const dem = await sampleDem(positions, reader, [coarse]);
      expect(new Set(dem.heights)).toEqual(new Set([1020, 1210]));
      expect(new Set(dem.levelled)).toEqual(new Set([1020]));
      const profile = buildElevationProfile(positions, dem);
      expect(profile.gainM).toBe(0);
      expect(profile.lossM).toBe(0);
      expect(profile.minM).toBe(1020); // the chart still shows both levels
      expect(profile.maxM).toBe(1210);
    });

    // Mutation: test for a seam before the gap and the step is read from
    // `coarse` at both ends: 190 m of climb, and a read that was never needed.
    it("is not measured as a seam when the two sides read from different sources", async () => {
      const spy = vi.fn(reader);
      const positions = densifyLineSegments(paused);
      const dem = await sampleDem(positions, spy, [fine, coarse]);
      expect(new Set(dem.sourceIds)).toEqual(new Set(["fine", "coarse"]));
      expect(new Set(dem.levelled)).toEqual(new Set([1010]));
      expect(spy.mock.calls.map(([src]) => src.id)).toEqual(["fine", "coarse"]);
    });

    // Mutation: compare a sample with its neighbour in the list instead of
    // the last one that has a height, and a gap hidden behind a sample no
    // source answered is climbed.
    it("is still a gap when the first sample after it has no height", async () => {
      const far = source("far", 1000, 1, [0, 100]);
      const positions = [
        { ...at(10), segment: 0 },
        { ...at(150), segment: 1 },
        { ...at(60), segment: 1 },
      ];
      const dem = await sampleDem(positions, reader, [far]);
      expect(dem.heights).toEqual([1010, null, 1060]);
      expect(dem.levelled).toEqual([1010, null, 1010]);
    });

    // A line with no gap goes down the path it always did: its positions
    // carry no segment, so the gap test can never be true for it.
    it("leaves a line in one piece exactly as it was", async () => {
      const positions = densifyLineSegments([level(10)]);
      expect(positions.some((position) => "segment" in position)).toBe(false);
    });
  });
});

describe("an open archive", () => {
  // Mutation: keep a failed archive in the cache, and the library's memory of
  // the failed header answers every later read without asking again.
  it("is opened afresh after a read of it fails", async () => {
    let online = false;
    let asked = 0;
    const source = {
      getKey: () => "archive-under-test",
      getBytes: async () => {
        asked++;
        if (!online) throw new Error("no connection");
        return { data: new ArrayBuffer(16384) };
      },
    };
    const first = demArchive(source);
    await expect(
      readDemArchive(first, NSW_5M, [{ tileX: 1, tileY: 1 }]),
    ).rejects.toThrow("no connection");
    const second = demArchive(source);
    expect(second).not.toBe(first);
    online = true;
    const before = asked;
    // The bytes are not an archive, so the read still fails: what matters is
    // that the source was asked again.
    await readDemArchive(second, NSW_5M, [{ tileX: 1, tileY: 1 }]).catch(
      () => {},
    );
    expect(asked).toBeGreaterThan(before);
    clearDemArchives();
  });
});
