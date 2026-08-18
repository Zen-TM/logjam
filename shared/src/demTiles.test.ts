import { describe, expect, it } from "vitest";

import {
  DEM_TILE_SIZE,
  DEM_TILE_ZOOM,
  demTileUrl,
  demMetresFromRgb,
  demSampleValue,
  resolveDemSamples,
} from "./demTiles.js";
import { lonLatToTile } from "./mapRegionEstimate.js";

// Katoomba-ish, inside the fixture tile used by the mobile decoder test.
const KATOOMBA = { lon: 150.312, lat: -33.714, distanceM: 0 };

describe("resolveDemSamples", () => {
  // The download plans tiles with `lonLatToTile` and the sampler addresses them
  // with `demTileCoordinates`. If those two ever disagree, a region downloads
  // the tiles either side of the one it later reads — and every profile over a
  // saved area comes back null. This is the test that fails first.
  it("addresses the same tile the region planner would download", () => {
    const [address] = resolveDemSamples([KATOOMBA]);
    const planned = lonLatToTile(KATOOMBA.lon, KATOOMBA.lat, DEM_TILE_ZOOM);
    expect({ x: address.tileX, y: address.tileY }).toEqual(planned);
  });

  it("keeps every pixel index inside the tile, including on its far edge", () => {
    // A position landing exactly on a tile boundary floors to `DEM_TILE_SIZE`
    // without the clamp, reading the first pixel of the next row.
    const tileSpanDegrees = 360 / 2 ** DEM_TILE_ZOOM;
    const onBoundary = { lon: -180 + tileSpanDegrees, lat: 0, distanceM: 0 };
    for (const address of resolveDemSamples([KATOOMBA, onBoundary])) {
      expect(address.index).toBeGreaterThanOrEqual(0);
      expect(address.index).toBeLessThan(DEM_TILE_SIZE * DEM_TILE_SIZE);
    }
  });

  it("preserves input order, so heights line up with distances", () => {
    const west = { lon: 150.0, lat: -33.7, distanceM: 0 };
    const east = { lon: 150.6, lat: -33.7, distanceM: 100 };
    const [a, b] = resolveDemSamples([west, east]);
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

describe("demTileUrl", () => {
  // The mobile repo commits a REAL terrarium tile as a decode fixture, named
  // for its address: z13, x=7516, y=4911 (Blue Gum Forest / Grose Valley).
  // That makes it the one address whose correct URL is independently known.
  it("addresses the tile the committed decode fixture came from", () => {
    expect(demTileUrl(7516, 4911)).toBe(
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/7516/4911.png",
    );
  });

  it("uses the XYZ row, not the TMS row an MBTiles store flips to", () => {
    // Silent failure guard: the TMS row at z13 (8191 - 4911 = 3280) is also a
    // real tile, so the wrong one returns heights rather than an error.
    expect(demTileUrl(7516, 4911)).not.toContain("3280");
  });
});
