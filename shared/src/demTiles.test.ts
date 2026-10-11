import { describe, expect, it } from "vitest";

import {
  DEM_TILE_SIZE,
  demMetresFromRgb,
  demSampleHeight,
  demSampleValue,
  demTileCoordinates,
  resolveDemSamples,
} from "./demTiles.js";
import { lonLatToTile } from "./mapRegionEstimate.js";

const DEM_TILE_ZOOM = 13;

// Katoomba-ish, inside the fixture tile used by the mobile decoder test.
const KATOOMBA = { lon: 150.312, lat: -33.714, distanceM: 0 };

describe("resolveDemSamples", () => {
  // The download plans tiles with `lonLatToTile` and the sampler addresses them
  // with `demTileCoordinates`. If those two ever disagree, a region downloads
  // the tiles either side of the one it later reads — and every profile over a
  // saved area comes back null. This is the test that fails first.
  it("addresses the same tile the region planner would download", () => {
    const [address] = resolveDemSamples([KATOOMBA], DEM_TILE_ZOOM);
    const planned = lonLatToTile(KATOOMBA.lon, KATOOMBA.lat, DEM_TILE_ZOOM);
    expect({ x: address.tileX, y: address.tileY }).toEqual(planned);
  });

  it("keeps every pixel index inside the tile, including on its far edge", () => {
    // A position landing exactly on a tile boundary floors to `DEM_TILE_SIZE`
    // without the clamp, reading the first pixel of the next row.
    const tileSpanDegrees = 360 / 2 ** DEM_TILE_ZOOM;
    const onBoundary = { lon: -180 + tileSpanDegrees, lat: 0, distanceM: 0 };
    for (const address of resolveDemSamples(
      [KATOOMBA, onBoundary],
      DEM_TILE_ZOOM,
    )) {
      expect(address.index).toBeGreaterThanOrEqual(0);
      expect(address.index).toBeLessThan(DEM_TILE_SIZE * DEM_TILE_SIZE);
    }
  });

  it("preserves input order, so heights line up with distances", () => {
    const west = { lon: 150.0, lat: -33.7, distanceM: 0 };
    const east = { lon: 150.6, lat: -33.7, distanceM: 100 };
    const [a, b] = resolveDemSamples([west, east], DEM_TILE_ZOOM);
    expect(a.tileX).toBeLessThan(b.tileX);
  });
});

describe("terrarium decoding", () => {
  it("decodes the encoding's anchors", () => {
    expect(demMetresFromRgb(128, 0, 0)).toBe(0);
    expect(demMetresFromRgb(128, 100, 0)).toBe(100);
    expect(demMetresFromRgb(127, 156, 128)).toBeCloseTo(-99.5, 6);
  });

  it("reads no-data and a missing tile as unknown, never as sea level", () => {
    expect(demSampleValue(new Float32Array([-32768]), 0)).toBeNull();
    expect(demSampleValue(null, 0)).toBeNull();
    expect(demSampleValue(new Float32Array([0]), 0)).toBe(0);
  });
});

describe("demSampleHeight", () => {
  // A tile whose height is its pixel column: a plane rising 1 m per pixel
  // eastwards, so the right answer anywhere is the fractional column.
  const ramp = new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE).map(
    (_, i) => i % DEM_TILE_SIZE,
  );
  /** A position at fractional pixel (column, row) of the tile KATOOMBA is in. */
  function at(column: number, row: number) {
    const scale = 2 ** DEM_TILE_ZOOM;
    const home = demTileCoordinates(KATOOMBA.lon, KATOOMBA.lat, DEM_TILE_ZOOM);
    const x = Math.floor(home.x) + column / DEM_TILE_SIZE;
    const y = Math.floor(home.y) + row / DEM_TILE_SIZE;
    const lat =
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI;
    return { lon: (x / scale) * 360 - 180, lat, distanceM: 0 };
  }
  const heightAt = (column: number, row: number, tile = ramp) =>
    demSampleHeight(
      tile,
      resolveDemSamples([at(column, row)], DEM_TILE_ZOOM)[0]!,
    );

  // Mutation: read `address.index` alone (the nearest pixel) and the first
  // expectation returns 10 or 11 instead of 10.5.
  it("blends between pixel centres instead of stepping at pixel edges", () => {
    // Pixel centres sit at .5: column 11.0 is midway between pixels 10 and 11.
    expect(heightAt(11.0, 40.5)).toBeCloseTo(10.5, 3);
    expect(heightAt(10.5, 40.5)).toBeCloseTo(10, 3);
    expect(heightAt(10.75, 40.2)).toBeCloseTo(10.25, 3);
  });

  it("holds the edge pixel's height out to the tile's edge", () => {
    expect(heightAt(0.1, 40.5)).toBeCloseTo(0, 3);
    expect(heightAt(DEM_TILE_SIZE - 0.1, 40.5)).toBeCloseTo(
      DEM_TILE_SIZE - 1,
      3,
    );
  });

  it("leaves a no-data neighbour out rather than averaging it in", () => {
    const holed = ramp.slice();
    holed[40 * DEM_TILE_SIZE + 11] = -32768;
    expect(heightAt(11.0, 40.5, holed)).toBeCloseTo(10, 3);
    expect(
      demSampleHeight(
        null,
        resolveDemSamples([at(11, 40.5)], DEM_TILE_ZOOM)[0]!,
      ),
    ).toBe(null);
    expect(
      heightAt(11.0, 40.5, new Float32Array(ramp.length).fill(-32768)),
    ).toBe(null);
  });
});
