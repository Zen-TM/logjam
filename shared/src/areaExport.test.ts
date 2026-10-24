import { describe, expect, it } from "vitest";
import {
  AREA_EXPORT_MAX_SIDE_KM,
  areaExportRequestError,
  areaExportStyleSnapshot,
  areaExportTooLarge,
  areaInNsw,
  areaSizeKm,
  type AreaBbox,
} from "./areaExport.js";
import { nswContourStyle } from "./nswContours.js";
import { RASTER_TEMPLATE_DEFAULTS } from "./topoSettings.js";

// A square of `sideKm` centred near Katoomba.
function square(sideKm: number, lat = -33.7, lon = 150.3): AreaBbox {
  const dLat = sideKm / 110.57 / 2;
  const dLon = sideKm / (111.32 * Math.cos((lat * Math.PI) / 180)) / 2;
  return {
    west: lon - dLon,
    south: lat - dLat,
    east: lon + dLon,
    north: lat + dLat,
  };
}

describe("areaSizeKm", () => {
  it("measures a box on the ground", () => {
    const { widthKm, heightKm } = areaSizeKm(square(20));
    expect(widthKm).toBeCloseTo(20, 1);
    expect(heightKm).toBeCloseTo(20, 1);
  });
});

describe("areaExportTooLarge", () => {
  // Mutation: compare the area, or the shorter side, with the limit, and a
  // long thin strip past the limit gets through.
  it("refuses a box whose longer side is past the limit", () => {
    expect(areaExportTooLarge(square(AREA_EXPORT_MAX_SIDE_KM - 1))).toBe(false);
    expect(areaExportTooLarge(square(AREA_EXPORT_MAX_SIDE_KM + 1))).toBe(true);
    const long = square(AREA_EXPORT_MAX_SIDE_KM + 1);
    const strip = { ...square(5), north: long.north, south: long.south };
    expect(areaExportTooLarge(strip)).toBe(true);
  });
});

describe("areaInNsw", () => {
  it("is true for a box touching NSW and false out at sea", () => {
    expect(areaInNsw(square(10))).toBe(true);
    expect(areaInNsw(square(10, -33.7, 156))).toBe(false);
  });
});

describe("areaExportRequestError", () => {
  const ok = { bbox: square(10), layers: ["heights"], format: "geotiff" };

  it("accepts a box, a format and layers that fit it", () => {
    expect(areaExportRequestError(ok)).toBeNull();
    expect(
      areaExportRequestError({
        ...ok,
        format: "gpkg",
        layers: ["heights", "slope", "hillshade", "contours"],
      }),
    ).toBeNull();
  });

  // Mutation: let every format hold every layer, and a GeoTIFF is asked for
  // contours it cannot hold.
  it("refuses contours in a GeoTIFF", () => {
    expect(
      areaExportRequestError({ ...ok, layers: ["heights", "contours"] }),
    ).not.toBeNull();
  });

  // Mutation: give MBTiles every layer, and the worker is asked to draw
  // heights it has no style for.
  it("draws an MBTiles from slope, hillshade and contours, never heights", () => {
    expect(
      areaExportRequestError({
        ...ok,
        format: "mbtiles",
        layers: ["slope", "hillshade", "contours"],
      }),
    ).toBeNull();
    expect(
      areaExportRequestError({ ...ok, format: "mbtiles", layers: ["heights"] }),
    ).not.toBeNull();
  });

  it("refuses an empty, inverted or off-Earth box, and bad layers", () => {
    expect(
      areaExportRequestError({
        ...ok,
        bbox: { ...ok.bbox, north: ok.bbox.south },
      }),
    ).not.toBeNull();
    expect(
      areaExportRequestError({ ...ok, bbox: { ...ok.bbox, north: 95 } }),
    ).not.toBeNull();
    expect(areaExportRequestError({ ...ok, layers: [] })).not.toBeNull();
    expect(
      areaExportRequestError({ ...ok, layers: ["heights", "heights"] }),
    ).not.toBeNull();
    expect(areaExportRequestError({ ...ok, format: "geojson" })).not.toBeNull();
  });
});

describe("areaExportStyleSnapshot", () => {
  const bands = [{ fromDeg: 30, toDeg: 90, colour: "#ff000080" }];

  // Mutation: snapshot `{}` for an MBTiles, or name the key anything but
  // slopeBands, and the file is drawn in the default bands, not the account's.
  it("draws an MBTiles in the account's slope bands", () => {
    expect(
      areaExportStyleSnapshot("mbtiles", { slopeBands: bands }).slopeBands,
    ).toEqual(bands);
  });

  // Mutation: snapshot the account's bands as stored, and an account that
  // never set any sends the worker none.
  it("gives an account with no bands the defaults", () => {
    expect(areaExportStyleSnapshot("mbtiles", null).slopeBands).toEqual(
      RASTER_TEMPLATE_DEFAULTS.slope.bands,
    );
  });

  // Mutation: draw them in any look but the map's (the imagery one, say),
  // and the file's statewide contours look unlike the map's.
  it("draws the statewide contours as the map does", () => {
    const { slopeBands: _, ...style } = areaExportStyleSnapshot("mbtiles", {
      slopeBands: bands,
    });
    expect(style).toEqual(nswContourStyle("protomaps"));
  });

  // Mutation: snapshot a style for every format, and raw data claims a style
  // nothing draws.
  it("saves no style for raw data", () => {
    expect(areaExportStyleSnapshot("geotiff", { slopeBands: bands })).toEqual(
      {},
    );
    expect(areaExportStyleSnapshot("gpkg", { slopeBands: bands })).toEqual({});
  });
});
