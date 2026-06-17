import { describe, it, expect } from "vitest";
import {
  computeTileToMapTransform,
  lon2tileX,
  lat2tileY,
  tileX2lon,
  tileY2lat,
  latToMercY,
} from "./geoPdfTileMath";

// Edge-case coverage for the GeoPDF projection math extracted from
// generateGeoPdf.ts. These are the calculations most prone to silent errors at
// high zoom / extreme latitude — previously untested.

describe("tile index round-trips", () => {
  it.each([8, 12, 16, 20])("a point falls inside the tile it maps to (z=%i)", (z) => {
    const lon = 150.3123;
    const x = lon2tileX(lon, z);
    expect(tileX2lon(x, z)).toBeLessThanOrEqual(lon); // west edge <= lon
    expect(tileX2lon(x + 1, z)).toBeGreaterThan(lon); // next tile's west edge > lon

    const lat = -33.6392;
    const y = lat2tileY(lat, z);
    expect(tileY2lat(y, z)).toBeGreaterThanOrEqual(lat); // north edge >= lat
    expect(tileY2lat(y + 1, z)).toBeLessThan(lat); // next tile's north edge < lat
  });
});

describe("latToMercY", () => {
  it("is monotonically decreasing as latitude decreases (north > south)", () => {
    expect(latToMercY(-33.6)).toBeGreaterThan(latToMercY(-33.7));
    expect(latToMercY(0)).toBe(0);
  });
});

describe("computeTileToMapTransform", () => {
  it("covers the full tile grid and is internally consistent for a normal extent", () => {
    const north = -33.6,
      south = -33.68,
      east = 150.34,
      west = 150.26,
      z = 14;
    const widthPx = 1000,
      heightPx = 1000;
    const t = computeTileToMapTransform(z, north, south, east, west, widthPx, heightPx);

    const minTileX = lon2tileX(west, z);
    const maxTileX = lon2tileX(east, z);
    const minTileY = lat2tileY(north, z);
    const maxTileY = lat2tileY(south, z);

    expect(t.minTileX).toBe(minTileX);
    expect(t.minTileY).toBe(minTileY);
    expect(t.tiles).toHaveLength(
      (maxTileX - minTileX + 1) * (maxTileY - minTileY + 1),
    );
    expect(t.tiles.every((tile) => tile.z === z)).toBe(true);

    // Source spans are positive and the extent sits within the tile grid.
    expect(t.srcW).toBeGreaterThan(0);
    expect(t.srcH).toBeGreaterThan(0);
    expect(t.offsetX).toBeGreaterThanOrEqual(0);
    expect(t.offsetY).toBeGreaterThanOrEqual(0);

    // scale factors are exactly output/source.
    expect(t.scaleX).toBeCloseTo(widthPx / t.srcW, 10);
    expect(t.scaleY).toBeCloseTo(heightPx / t.srcH, 10);

    for (const v of [t.offsetX, t.offsetY, t.srcW, t.srcH, t.scaleX, t.scaleY]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("stays finite and positive at very high zoom (tiny extent)", () => {
    const t = computeTileToMapTransform(
      20,
      -33.6,
      -33.601,
      150.301,
      150.3,
      500,
      500,
    );
    expect(t.tiles.length).toBeGreaterThanOrEqual(1);
    expect(t.srcW).toBeGreaterThan(0);
    expect(t.srcH).toBeGreaterThan(0);
    expect(Number.isFinite(t.scaleX)).toBe(true);
    expect(Number.isFinite(t.scaleY)).toBe(true);
  });

  it("stays finite at extreme (high-magnitude) latitude", () => {
    const t = computeTileToMapTransform(6, -79.0, -80.0, 150.5, 149.5, 800, 600);
    expect(t.srcH).toBeGreaterThan(0);
    expect(Number.isFinite(t.srcH)).toBe(true);
    expect(Number.isFinite(t.offsetY)).toBe(true);
  });
});
