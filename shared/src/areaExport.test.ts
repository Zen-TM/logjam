import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AREA_EXPORT_MAX_SIDE_KM,
  areaExportEpsg,
  areaExportGrid,
  areaExportRegion,
  areaExportRequestError,
  areaExportStyleSnapshot,
  areaExportTooLarge,
  areaExportOutsideTerrain,
  areaInTerrainRegion,
  areaExportTooLargeSentence,
  areaSizeKm,
  type AreaBbox,
} from "./areaExport.js";
import { nswContourStyle } from "./contourRules.js";
import { NSW_REGION, REGIONS, REGIONS_WITH_SIMULATED } from "./regions.js";
import { SIM_NZ, SIM_REGIONS, SIM_UTAH } from "./simRegions.js";
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

// A box of `half` degrees either side of a centre.
const boxAround = (lon: number, lat: number, half: number): AreaBbox => ({
  west: lon - half,
  south: lat - half,
  east: lon + half,
  north: lat + half,
});

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
  it("is the grid of the region the box is exported from", () => {
    expect(areaExportEpsg(square(10), REGIONS)).toBe(7856); // Katoomba
    expect(areaExportEpsg(square(10, -33.7, 147), REGIONS)).toBe(7855);
    expect(areaExportEpsg(square(10, -31.95, 141.45), REGIONS)).toBe(7854);
    expect(areaExportEpsg(square(10, -44.055, 169.25), SIM_REGIONS)).toBe(2193);
    // Utah: UTM north, zone 12.
    expect(areaExportEpsg(square(10, 37.285, -112.945), SIM_REGIONS)).toBe(
      32612,
    );
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

  // A box centred outside NSW's border that still overlaps it is admitted by
  // `areaInTerrainRegion`, and is warped to MGA like the rest of the state.
  // Mutation: resolve the region from the box's centre point alone (give
  // `regionInView` a box with no width), and each of these gets UTM, a datum
  // off by about 2 m.
  it("stays in MGA for a box over NSW's edge whose centre is outside it", () => {
    const nsw = (lon: number, lat: number, half: number) =>
      areaExportEpsg(boxAround(lon, lat, half));
    expect(nsw(153.1, -28.2, 0.1)).toBe(7856); // off the Queensland border
    expect(nsw(140.8, -33, 0.3)).toBe(7854); // off the South Australian one
    expect(nsw(154.6, -30, 0.5)).toBe(7856); // east of the border's 154.2 cut
  });

  // Made-up regions on a flat map: `bare` has no heights and its own grid,
  // `full` and `other` have heights. The box is read by the regions with
  // heights, the first of them in list order, wherever it is centred.
  describe("with a region that has no heights", () => {
    const ring = (w: number, s: number, e: number, n: number) =>
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
      ] as [number, number][];
    const bare = {
      ...SIM_NZ,
      id: "bare",
      grid: "nztm2000" as const,
      terrain: {},
      borders: [ring(10, 10, 20, 20)],
    };
    const full = { ...SIM_UTAH, id: "full", borders: [ring(15, 10, 25, 20)] };
    const other = {
      ...SIM_NZ,
      id: "other",
      grid: "nztm2000" as const,
      borders: [ring(5, 22, 12, 30)],
    };
    const UTM_33_NORTH = 32633;

    // Mutation: drop the `hasExportArchives` filter, and the box takes
    // the grid of `bare`, which the export reads no heights from.
    it("takes the grid of the first region with heights that the box touches", () => {
      const box = boxAround(14, 25, 6); // centred in none, over all three
      expect(areaExportEpsg(box, [bare, full, other])).toBe(UTM_33_NORTH);
    });

    // Mutation: reverse `exporting` before `regionsTouching`, and `other`
    // wins.
    it("goes by list order between two regions with heights", () => {
      const box = boxAround(14, 25, 6);
      expect(areaExportEpsg(box, [bare, full, other])).toBe(UTM_33_NORTH);
      expect(areaExportEpsg(box, [bare, other, full])).toBe(2193);
    });

    // Mutation: pass `regions` to `regionAt` in place of `exporting`, and a
    // box centred in `bare` takes its grid.
    it("ignores a region with no heights even where it holds the centre", () => {
      const box = boxAround(12, 15, 4); // centred in `bare`, over `full`
      expect(areaExportEpsg(box, [bare, full, other])).toBe(UTM_33_NORTH);
    });
  });

  // The worker falls back to `7800 + zone` for a job an older API queued
  // (topo/tests/test_area_export.py, `MgaZone`): the two agree for every box
  // the API admits, whether its centre is inside NSW's border or just
  // outside it on any side.
  // Mutation: shift the zone boundary in `MGA_ZONES` by a degree, and the
  // box either side of it is warped to the neighbour's zone.
  it("agrees with the old rule for every box admitted over NSW", () => {
    const old = (lon: number) => 7800 + Math.floor((lon + 180) / 6) + 1;
    const centres: [number, number, number][] = [];
    for (let lon = 141; lon <= 153.5; lon += 0.5)
      centres.push([lon, -33, 0.05]);
    // Just outside the border on each side, boxes wide enough to reach it.
    for (const lon of [141.5, 144.5, 147]) centres.push([lon, -28.6, 0.5]);
    for (const lon of [149.9, 150.1, 153]) centres.push([lon, -38, 0.5]);
    centres.push([147, -38, 1.2]);
    for (const lat of [-30, -34]) centres.push([140.6, lat, 0.5]);
    for (const lat of [-30, -34, -36]) centres.push([154.7, lat, 0.7]);
    for (const [lon, lat, half] of centres) {
      const box = boxAround(lon, lat, half);
      expect(areaInTerrainRegion(box), `${lon} ${lat}`).toBe(true);
      expect(areaExportEpsg(box), `${lon} ${lat}`).toBe(old(lon));
    }
  });
});

describe("areaExportRegion", () => {
  type Case = {
    why: string;
    bbox: [number, number, number, number];
    region: string | null;
  };
  const fixture = JSON.parse(
    readFileSync(
      new URL("./__fixtures__/export-region.json", import.meta.url),
      "utf8",
    ),
  ) as {
    cases: Case[];
    madeUp: {
      regions: {
        id: string;
        box: [number, number, number, number];
        archives: (keyof typeof SIM_UTAH.terrain)[];
      }[];
      cases: Case[];
    };
  };
  const asBox = ([west, south, east, north]: Case["bbox"]) => ({
    west,
    south,
    east,
    north,
  });

  // Mutation: test the centre only (give `regionAt` the centre and drop the
  // `regionsTouching` fallback), and a box over NSW's edge is read from no
  // region, as topo/regions.py `export_region` (its test reads the same
  // cases) reads it from NSW.
  it("is the region the worker reads the archives from", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(8);
    for (const { why, bbox, region } of fixture.cases)
      expect(
        areaExportRegion(asBox(bbox), REGIONS_WITH_SIMULATED)?.id ?? null,
        why,
      ).toBe(region);
  });

  // Mutation: drop the `regionAt` step (take the first region touching the
  // box), and a box centred in a later region is read from an earlier one it
  // also touches; or keep every region that declares heights (drop the slope
  // and contours test in `hasExportArchives`), and a box over a region with
  // no slope is exported from it, and fails in the worker.
  it("holds the centre first and skips a region missing an archive, as the worker does", () => {
    const regions = fixture.madeUp.regions.map(({ id, box, archives }) => {
      const [w, s, e, n] = box;
      return {
        ...SIM_UTAH,
        id,
        borders: [
          [
            [w, s],
            [e, s],
            [e, n],
            [w, n],
          ] as [number, number][],
        ],
        terrain: Object.fromEntries(
          archives.map((layer) => [layer, SIM_UTAH.terrain[layer]]),
        ),
      };
    });
    expect(fixture.madeUp.cases.length).toBeGreaterThanOrEqual(4);
    for (const { why, bbox, region } of fixture.madeUp.cases)
      expect(areaExportRegion(asBox(bbox), regions)?.id ?? null, why).toBe(
        region,
      );
  });

  // Mutation: answer `regions[0]` for a box no region touches, and an export
  // of open sea is warped to a region's grid, not UTM.
  it("gives a box no region touches the UTM grid", () => {
    const sea = { west: 155.5, south: -34, east: 156.5, north: -33.5 };
    expect(areaExportRegion(sea, REGIONS_WITH_SIMULATED)).toBeNull();
    expect(areaExportGrid(sea, REGIONS_WITH_SIMULATED)).toBe("utm");
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

  // Mutation: put a region's name in the sentence, and it goes stale when a
  // region is added or this one is renamed.
  it("names no region in its refusal", () => {
    for (const region of REGIONS_WITH_SIMULATED)
      expect(areaExportOutsideTerrain()).not.toContain(region.name);
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

describe("areaExportTooLargeSentence", () => {
  // Mutation: change AREA_EXPORT_MAX_SIDE_KM to 120 without the sentence.
  it("says the limit it enforces", () => {
    expect(areaExportTooLargeSentence()).toContain(
      `${AREA_EXPORT_MAX_SIDE_KM} km`,
    );
  });
});
