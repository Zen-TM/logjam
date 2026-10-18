import { describe, expect, it } from "vitest";

import {
  demSlopeAt,
  demSlopeReading,
  demSlopeWindow,
  slopeDegrees,
} from "./demSlope.js";
import { NSW_5M, type DemSource, type DemTileReader } from "./demSources.js";
import { DEM_TILE_SIZE, resolveDemSamples } from "./demTiles.js";
import { haversineMeters } from "./placeGeo.js";

const DEM_TILE_ZOOM = NSW_5M.sampleZoom;

/** A made-up point at a New South Wales latitude. */
const POINT = { lon: 150.2, lat: -33.5 };

/** Heights of a plane over the window: `east`/`south` are rise per cell. */
function plane(east: number, south: number): number[] {
  const heights: number[] = [];
  for (let row = -1; row <= 1; row++) {
    for (let col = -1; col <= 1; col++) {
      heights.push(500 + col * east + row * south);
    }
  }
  return heights;
}

describe("slopeDegrees", () => {
  it("reads a plane's own angle, whichever way it faces", () => {
    // Rise equal to run is 45°. Turns red if either gradient drops its /8 or
    // the two are added instead of combined as a hypotenuse.
    expect(slopeDegrees(plane(10, 0), 10)).toBeCloseTo(45, 6);
    expect(slopeDegrees(plane(0, -10), 10)).toBeCloseTo(45, 6);
    expect(slopeDegrees(plane(3, 4), 5)).toBeCloseTo(45, 6);
    expect(slopeDegrees(plane(0, 0), 10)).toBe(0);
  });

  it("scales with the cell size, so the same heights are gentler when further apart", () => {
    expect(slopeDegrees(plane(10, 0), 20)).toBeCloseTo(
      (Math.atan(0.5) * 180) / Math.PI,
      6,
    );
  });

  it("is unknown when any height in the window is, never a guess", () => {
    // Turns red if a missing neighbour is skipped or read as zero: either
    // gives a confident slope at the edge of a saved region.
    const heights: (number | null)[] = plane(10, 0);
    heights[8] = null;
    expect(slopeDegrees(heights, 10)).toBeNull();
    expect(slopeDegrees(plane(10, 0).slice(0, 8), 10)).toBeNull();
    expect(slopeDegrees(plane(10, 0), 0)).toBeNull();
  });
});

describe("demSlopeWindow", () => {
  it("asks for the tapped pixel and its eight neighbours, in reading order", () => {
    const { positions } = demSlopeWindow(POINT.lon, POINT.lat, DEM_TILE_ZOOM);
    const pixels = resolveDemSamples(positions, DEM_TILE_ZOOM).map(
      (address) => ({
        x: address.tileX * DEM_TILE_SIZE + (address.index % DEM_TILE_SIZE),
        y:
          address.tileY * DEM_TILE_SIZE +
          Math.floor(address.index / DEM_TILE_SIZE),
      }),
    );
    const [tapped] = resolveDemSamples(
      [{ ...POINT, distanceM: 0 }],
      DEM_TILE_ZOOM,
    ).map((address) => ({
      x: address.tileX * DEM_TILE_SIZE + (address.index % DEM_TILE_SIZE),
      y:
        address.tileY * DEM_TILE_SIZE +
        Math.floor(address.index / DEM_TILE_SIZE),
    }));
    // Turns red if the window is offset from the pixel the height readout
    // uses, or if rows and columns are swapped (north-facing reads as east).
    expect(pixels).toEqual(
      [-1, 0, 1].flatMap((dy) =>
        [-1, 0, 1].map((dx) => ({ x: tapped!.x + dx, y: tapped!.y + dy })),
      ),
    );
  });

  it("crosses a tile edge without losing a neighbour", () => {
    // The north-west corner pixel of a tile: five of its neighbours live in
    // three other tiles.
    const tileSpan = 360 / 2 ** DEM_TILE_ZOOM;
    const corner = Math.round((POINT.lon + 180) / tileSpan) * tileSpan - 180;
    const { positions } = demSlopeWindow(
      corner + tileSpan / 1000,
      0 - 1e-6,
      DEM_TILE_ZOOM,
    );
    const tiles = new Set(
      resolveDemSamples(positions, DEM_TILE_ZOOM).map(
        (a) => `${a.tileX}/${a.tileY}`,
      ),
    );
    expect(tiles.size).toBe(4);
  });

  it("reports the ground distance between neighbours", () => {
    const { positions, cellM } = demSlopeWindow(
      POINT.lon,
      POINT.lat,
      DEM_TILE_ZOOM,
    );
    const west = positions[3]!;
    const east = positions[5]!;
    const north = positions[1]!;
    const south = positions[7]!;
    expect(
      haversineMeters(west.lat, west.lon, east.lat, east.lon) / 2,
    ).toBeCloseTo(cellM, 0);
    expect(
      haversineMeters(north.lat, north.lon, south.lat, south.lon) / 2,
    ).toBeCloseTo(cellM, 0);
    // About 4 m in NSW at zoom 15: the figure the accuracy of any slope shown
    // rests on.
    expect(cellM).toBeGreaterThan(3.8);
    expect(cellM).toBeLessThan(4.2);
  });
});

describe("demSlopeAt", () => {
  /** Every tile any source is asked for: ground rising `rise` m per pixel east. */
  const rising =
    (rise: number, asked: string[] = []): DemTileReader =>
    async (source, tiles) => {
      asked.push(source.id);
      return new Map(
        tiles.map((t) => [
          `${t.tileX}/${t.tileY}`,
          new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE).map(
            (_, i) => 500 + rise * (i % DEM_TILE_SIZE),
          ),
        ]),
      );
    };

  it("reads the slope of the ground the fine source describes", async () => {
    const { cellM } = demSlopeWindow(POINT.lon, POINT.lat, DEM_TILE_ZOOM);
    expect(await demSlopeAt(POINT.lon, POINT.lat, rising(cellM))).toBeCloseTo(
      45,
      // Tiles hold 32-bit heights.
      2,
    );
  });

  // Mutation: sample down the whole source list like a height does, and both
  // cases below show a slope from the 30 m tiles, which are inaccurate by more
  // than 5° at four points in ten.
  it("shows nothing rather than a slope from the coarse worldwide tiles", async () => {
    const asked: string[] = [];
    // Hobart: outside the fine source's coverage.
    expect(await demSlopeAt(147.3, -42.9, rising(1, asked))).toBeNull();
    expect(asked).toEqual([]);

    const onlyCoarse: DemTileReader = async (source, tiles) =>
      source.id === NSW_5M.id ? new Map() : rising(1, asked)(source, tiles);
    expect(await demSlopeAt(POINT.lon, POINT.lat, onlyCoarse)).toBeNull();
    expect(asked).toEqual([]);
  });

  /** A made-up finer source over the same ground as POINT. */
  const FINE = {
    ...NSW_5M,
    id: "fine-1m",
    sampleZoom: 17,
    coverage: [150, -34, 151, -33],
  } as const satisfies DemSource;

  // Mutation: ignore `sources` and read `NSW_5M` alone, and the finer source
  // never answers.
  it("reads the finest source that has the window, all nine heights from it", async () => {
    const asked: string[] = [];
    const reading = await demSlopeReading(
      POINT.lon,
      POINT.lat,
      rising(1, asked),
      [FINE, NSW_5M],
    );
    expect(reading?.sourceId).toBe(FINE.id);
    expect(asked).toEqual([FINE.id]);
    const { cellM } = demSlopeWindow(POINT.lon, POINT.lat, FINE.sampleZoom);
    expect(reading?.slopeDegrees).toBeCloseTo(
      (Math.atan(1 / cellM) * 180) / Math.PI,
      2,
    );
  });

  /** Ground rising 5 m a pixel on the finer source, 1 m on `NSW_5M`. */
  const twoGrounds: DemTileReader = (source, tiles) =>
    rising(source.id === FINE.id ? 5 : 1)(source, tiles);

  /** What `NSW_5M` alone reads at POINT over `rising(1)`. */
  const coarseOwn = () =>
    demSlopeReading(POINT.lon, POINT.lat, rising(1), [NSW_5M]);

  // Mutation: fill the finer source's gaps from `NSW_5M`, or accept a window
  // some of whose positions the finer source does not cover: the slope would
  // span two surfaces and differ from NSW_5M's own.
  it("falls through to the next source when the finer one covers only part of the window", async () => {
    const { positions } = demSlopeWindow(POINT.lon, POINT.lat, FINE.sampleZoom);
    // East edge halfway between the centre column and the east one.
    const edge = (positions[4]!.lon + positions[5]!.lon) / 2;
    const partial = { ...FINE, coverage: [150, -34, edge, -33] } as const;
    const reading = await demSlopeReading(POINT.lon, POINT.lat, twoGrounds, [
      partial,
      NSW_5M,
    ]);
    expect(reading?.sourceId).toBe(NSW_5M.id);
    expect(reading?.slopeDegrees).toBeCloseTo(
      (await coarseOwn())!.slopeDegrees,
      6,
    );
  });

  // Mutation: read the window through `sampleDem`, whose bilinear blend fills a
  // lone no-data pixel from its neighbours: the finer source would answer.
  it("falls through when one pixel of the finer source's window has no data", async () => {
    const { positions } = demSlopeWindow(POINT.lon, POINT.lat, FINE.sampleZoom);
    const [corner] = resolveDemSamples([positions[2]!], FINE.sampleZoom);
    const holed: DemTileReader = async (source, tiles) => {
      const found = await twoGrounds(source, tiles);
      if (source.id === FINE.id)
        found.get(`${corner!.tileX}/${corner!.tileY}`)![corner!.index] = -32768;
      return found;
    };
    const reading = await demSlopeReading(POINT.lon, POINT.lat, holed, [
      FINE,
      NSW_5M,
    ]);
    expect(reading?.sourceId).toBe(NSW_5M.id);
    expect(reading?.slopeDegrees).toBeCloseTo(
      (await coarseOwn())!.slopeDegrees,
      6,
    );
  });
});
