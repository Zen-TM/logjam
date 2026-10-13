import { describe, expect, it } from "vitest";

import { demSlopeAt, demSlopeWindow, slopeDegrees } from "./demSlope.js";
import { NSW_5M, type DemTileReader } from "./demSources.js";
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
});
