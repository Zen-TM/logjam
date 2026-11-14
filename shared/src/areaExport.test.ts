import { describe, expect, it } from "vitest";
import {
  AREA_EXPORT_MAX_SIDE_KM,
  areaExportEpsg,
  areaExportRequestError,
  areaExportStyleSnapshot,
  areaExportTooLarge,
  AREA_EXPORT_OUTSIDE_TERRAIN,
  areaInTerrainRegion,
  AREA_EXPORT_TOO_LARGE,
  areaSizeKm,
  type AreaBbox,
} from "./areaExport.js";
import { nswContourStyle } from "./nswContours.js";
import { layerIn, NSW_REGION, REGIONS } from "./regions.js";
import { SIM_REGIONS } from "./simRegions.js";
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

describe("areaExportEpsg", () => {
  // Mutation: return 7800 + the UTM zone of the centre for every region (the
  // old worker's rule), and a New Zealand box is warped to a code that is not
  // a grid there.
  it("is the grid of the region at the box's centre", () => {
    expect(areaExportEpsg(square(10), REGIONS)).toBe(7856); // Katoomba
    expect(areaExportEpsg(square(10, -33.7, 147), REGIONS)).toBe(7855);
    expect(areaExportEpsg(square(10, -31.95, 141.45), REGIONS)).toBe(7854);
    expect(areaExportEpsg(square(10, -44.62, 169.1), SIM_REGIONS)).toBe(2193);
    // Utah: UTM north, zone 12.
    expect(areaExportEpsg(square(10, 38.27, -110.8), SIM_REGIONS)).toBe(32612);
  });

  // Mutation: pick the zone by a box's west edge instead of its centre, and
  // a box over the 150 line is warped to zone 55 instead of the 56 its
  // middle is in.
  it("reads the zone at the centre of a box over two zones", () => {
    const box = { west: 149.9, south: -33.8, east: 150.5, north: -33.6 };
    expect(areaExportEpsg(box)).toBe(7856);
  });

  // Mutation: answer 32600 + zone for the southern hemisphere too, and a
  // box in Chile is warped to the northern grid, 10,000 km off.
  it("is UTM outside every region, north or south of the equator", () => {
    expect(areaExportEpsg(square(10, 10, 0.5), SIM_REGIONS)).toBe(32631);
    expect(areaExportEpsg(square(10, -33.4, -70.6), SIM_REGIONS)).toBe(32719);
  });

  // The worker falls back to `7800 + zone` for a job an older API queued
  // (topo/tests/test_area_export.py, `MgaZone`): the two agree across NSW,
  // from the South Australian border to the coast.
  // Mutation: shift the zone boundary in `MGA_ZONES` by a degree, and the
  // box either side of it is warped to the neighbour's zone.
  it("agrees with the old rule across NSW", () => {
    for (let lon = 141; lon <= 153.5; lon += 0.5) {
      const old = 7800 + Math.floor((lon + 180) / 6) + 1;
      expect(areaExportEpsg(square(1, -33, lon)), `${lon}`).toBe(old);
    }
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

describe("areaInTerrainRegion", () => {
  it("is true for a box touching NSW and false out at sea", () => {
    expect(areaInTerrainRegion(square(10))).toBe(true);
    expect(areaInTerrainRegion(square(10, -33.7, 156))).toBe(false);
  });

  // Mutation: check the heights' coverage box again, and this one passes.
  it("goes by the border, not by the box around the terrain", () => {
    // Inside the 5 m DEM's coverage rectangle, but all of it in Victoria.
    const bendigo = square(10, -36.76, 144.28);
    expect(areaInTerrainRegion(bendigo)).toBe(false);
  });

  // Mutation: drop the heights test.
  it("skips a region with no terrain", () => {
    expect(
      areaInTerrainRegion(square(10), [{ ...NSW_REGION, terrain: {} }]),
    ).toBe(false);
  });

  // Mutation: add terrain to a region and leave the sentence alone.
  it("names every region with terrain in its refusal", () => {
    for (const region of REGIONS.filter((r) => layerIn(r, "heights")))
      expect(AREA_EXPORT_OUTSIDE_TERRAIN).toContain(region.name);
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

describe("AREA_EXPORT_TOO_LARGE", () => {
  // Mutation: change AREA_EXPORT_MAX_SIDE_KM to 120 without the sentence.
  it("says the limit it enforces", () => {
    expect(AREA_EXPORT_TOO_LARGE).toContain(`${AREA_EXPORT_MAX_SIDE_KM} km`);
  });
});
