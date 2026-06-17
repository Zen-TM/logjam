import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { decodeVectorTileLayer } from "./geoPdfVectorTile";

// Regression guard for the vector-tile3 / pbf5 decode path
// (`new VectorTile(new PbfReader(...))`) that shipped verified by tsc only.
// sample.mvt is a tiny committed fixture (api/src/services/__fixtures__): two
// layers — "contours" (1 LineString, ele="100") and "features" (1 Point,
// natural="peak").
const data = readFileSync(
  fileURLToPath(new URL("./__fixtures__/sample.mvt", import.meta.url)),
);

describe("decodeVectorTileLayer", () => {
  it("decodes a LineString feature with its properties from the contours layer", () => {
    const { present, features } = decodeVectorTileLayer(data, "contours");
    expect(present).toBe(true);
    expect(features).toHaveLength(1);
    const feature = features[0];
    expect(feature.type).toBe(2); // VectorTileFeature.types: 1=Point 2=LineString 3=Polygon
    expect(feature.properties.ele).toBe("100");
    const geom = feature.loadGeometry();
    expect(geom).toHaveLength(1);
    expect(geom[0]).toHaveLength(3);
    expect(geom[0][0]).toEqual({ x: 100, y: 100 });
    expect(geom[0][2]).toEqual({ x: 300, y: 100 });
  });

  it("decodes a Point feature with its properties from the features layer", () => {
    const { present, features } = decodeVectorTileLayer(data, "features");
    expect(present).toBe(true);
    expect(features).toHaveLength(1);
    expect(features[0].type).toBe(1); // Point
    expect(features[0].properties.natural).toBe("peak");
  });

  it("reports an absent layer as not present, with no features", () => {
    const result = decodeVectorTileLayer(data, "does-not-exist");
    expect(result.present).toBe(false);
    expect(result.features).toEqual([]);
  });

  it("never resurrects real layers from malformed bytes", () => {
    // The render path wraps decode in try/catch and skips the tile, so throwing
    // is acceptable — what must never happen is a garbage buffer reporting our
    // real layers as present.
    const garbage = Buffer.from([0xff, 0xff, 0xff, 0x0f, 0x7a, 0x01]);
    let present = false;
    try {
      present = decodeVectorTileLayer(garbage, "contours").present;
    } catch {
      present = false;
    }
    expect(present).toBe(false);
  });
});
