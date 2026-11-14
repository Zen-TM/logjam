import { describe, expect, it } from "vitest";

import {
  fromGrid,
  gridConvergence,
  gridIdAt,
  gridZoneAt,
  gridZonesFor,
  mgaZone,
  toGrid,
  toGridAt,
  type GridId,
} from "./grids.js";
import { NSW_REGION, REGIONS, type Region } from "./regions.js";

/** A made-up region with a box border. */
const region = (
  grid: GridId,
  [west, south, east, north]: [number, number, number, number],
): Region => ({
  ...NSW_REGION,
  id: `made-up-${grid}`,
  grid,
  borders: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
    ],
  ],
});
const NZ = region("nztm2000", [166, -48, 179, -34]);
const UTAH = region("utm", [-114.5, 36.5, -109.5, 42.5]);
const MADE_UP = [NSW_REGION, NZ, UTAH];

const dms = (d: number, m: number, s: number) => d + m / 60 + s / 3600;

describe("which grid a place uses", () => {
  // Mutation: return `regions[0].grid` regardless of the point, and NZ reads MGA.
  it("is the grid of the region holding the point", () => {
    expect(gridIdAt(151.2, -33.9)).toBe("mga2020"); // Sydney
    expect(gridIdAt(174.78, -41.29, MADE_UP)).toBe("nztm2000"); // Wellington
    expect(gridIdAt(-111.5, 37.5, MADE_UP)).toBe("utm");
  });

  // Mutation: default to "mga2020" outside every region.
  it("is UTM outside every region", () => {
    expect(gridIdAt(144.9, -37.8)).toBe("utm"); // Melbourne, outside NSW
    expect(gridIdAt(2.35, 48.85, MADE_UP)).toBe("utm");
  });
});

describe("NSW's MGA zones", () => {
  // Mutation: change a proj string or an edge and a printed grid shifts.
  it("are zones 54 to 56 with the proj strings the maps always used", () => {
    const sydney = gridZoneAt(151.2, -33.9);
    expect(sydney).toMatchObject({
      grid: "mga2020",
      name: "MGA 56",
      epsg: 7856,
    });
    expect(sydney.proj).toBe(
      "+proj=utm +zone=56 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
    );
    expect(gridZoneAt(148.6, -32.2).name).toBe("MGA 55"); // Dubbo
    expect(gridZoneAt(141.47, -31.95).name).toBe("MGA 54"); // Broken Hill
    expect(gridZoneAt(143.99, -33.7).name).toBe("MGA 54");
    expect(gridZoneAt(144, -33.7).name).toBe("MGA 55");
    expect(mgaZone(55).name).toBe("MGA 55");
  });

  // Lord Howe Island lies outside NSW's border ring, so it gets UTM: zone 57
  // south, whose 159 °E meridian is MGA's own zone 57 there (MGA 56 would be
  // the wrong meridian). Mutation: widen the border over the island and it
  // reads MGA 56.
  it("gives Lord Howe Island UTM 57 south, which draws as MGA 57 would", () => {
    const zone = gridZoneAt(159.1, -31.5);
    expect(zone).toMatchObject({ grid: "utm", name: "UTM 57", epsg: 32757 });
    expect(zone.centralMeridian).toBe(159);
  });

  // Mutation: swap lat and lon in `fromGrid`'s return.
  it("round-trips lat/lon through easting and northing", () => {
    for (const [lat, lon, name] of [
      [-33.685, 150.315, "MGA 56"],
      [-34.4, 145.0, "MGA 55"],
    ] as const) {
      const { easting, northing, zone } = toGridAt(lat, lon);
      expect(zone.name).toBe(name);
      const back = fromGrid(easting, northing, zone);
      expect(back.lat).toBeCloseTo(lat, 4);
      expect(back.lon).toBeCloseTo(lon, 4);
    }
  });

  // Mutation: drop `+south` from the MGA proj string.
  it("gives easting and northing in MGA's ranges", () => {
    const { easting, northing } = toGridAt(-33.685, 150.315);
    expect(easting).toBeGreaterThan(100000);
    expect(easting).toBeLessThan(900000);
    expect(northing).toBeGreaterThan(5000000);
    expect(northing).toBeLessThan(7000000);
  });
});

describe("NZTM2000", () => {
  // LINZ, "Projection transformation example points" (Transverse Mercator),
  // https://www.linz.govt.nz/guidance/geodetic-system/understanding-coordinate-conversions/projection-conversions/projection-transformation-example-points
  // Mutation: a wrong false easting or northing, central meridian or scale
  // factor moves both points by metres; a round trip alone would not notice.
  it.each([
    [-dms(41, 43, 44.6973), dms(172, 29, 58.2847), 1558376.32, 5380181.71],
    [-dms(44, 40, 24.6238), dms(167, 55, 26.6376), 1197666.98, 5040771.4],
  ])("matches LINZ's example point %#", (lat, lon, e, n) => {
    const got = toGridAt(lat, lon, MADE_UP);
    expect(got.zone).toMatchObject({ name: "NZTM", epsg: 2193 });
    expect(got.easting).toBeCloseTo(e, 2);
    expect(got.northing).toBeCloseTo(n, 2);
    const back = fromGrid(e, n, got.zone);
    expect(back.lat).toBeCloseTo(lat, 7);
    expect(back.lon).toBeCloseTo(lon, 7);
  });

  // Mutation: delete the `nztm2000` branch in `gridZonesFor`, and a box over
  // NZ lists several UTM zones.
  it("is one zone for the whole country", () => {
    expect(gridZoneAt(176.9, -39.5, MADE_UP).name).toBe("NZTM");
    expect(gridZoneAt(168.4, -46.4, MADE_UP).name).toBe("NZTM");
    expect(
      gridZonesFor(
        { west: 166.5, south: -47, east: 178.5, north: -35 },
        MADE_UP,
      ),
    ).toHaveLength(1);
  });
});

describe("UTM", () => {
  // USGS Professional Paper 1395 (Snyder), Appendix A, "Transverse Mercator
  // (ellipsoid), forward": Clarke 1866, k0 0.9996, zone 18's 75°W meridian,
  // 40°30'N 73°30'W gives x = 127,106.5 m, y = 4,484,124.4 m (the printed
  // values leave out the 500,000 m false easting). It uses Clarke 1866, so
  // the zone's ellipsoid is swapped; this checks `toGrid`'s transverse
  // Mercator and false easting against a published value.
  // Mutation: pass `[lat, lon]` to proj4 in `toGrid`.
  it("matches USGS's published zone 18 example", () => {
    const [lat, lon] = [40.5, -73.5];
    const zone = {
      ...gridZoneAt(lon, lat),
      proj: "+proj=tmerc +lat_0=0 +lon_0=-75 +k=0.9996 +x_0=500000 +ellps=clrk66 +units=m +no_defs",
    };
    const { easting, northing } = toGrid(lat, lon, zone);
    expect(easting - 500000).toBeCloseTo(127106.5, 0);
    expect(northing).toBeCloseTo(4484124.4, 0);
  });

  // Values from PROJ (pyproj 3.7) for EPSG:32612 and EPSG:32760: a cross-check
  // of the zone number, hemisphere and WGS84 ellipsoid, which the USGS example
  // above does not reach.
  // Mutation: drop `+south` or truncate `lon / 6` for the zone and these move.
  it.each([
    [37.2, -112, "UTM 12", 32612, 411256.293, 4117527.646],
    [37.5, -111.5, "UTM 12", 32612, 455804.816, 4150458.736],
    [-10, 179.5, "UTM 60", 32760, 774071.053, 8893548.722],
    [10, -179.5, "UTM 1", 32601, 225928.947, 1106451.278],
  ])("puts %f, %f in %s (EPSG:%i)", (lat, lon, name, epsg, e, n) => {
    const got = toGridAt(lat, lon);
    expect(got.zone).toMatchObject({ grid: "utm", name, epsg });
    expect(got.easting).toBeCloseTo(e, 2);
    expect(got.northing).toBeCloseTo(n, 2);
    const back = fromGrid(got.easting, got.northing, got.zone);
    expect(back.lat).toBeCloseTo(lat, 7);
    expect(back.lon).toBeCloseTo(lon, 7);
  });

  // Mutation: zone = floor(lon / 6) + 31 without the wrap, and 180° is zone 61.
  it("has zones 60 and 1 either side of 180°", () => {
    expect(gridZoneAt(179.99, 10).name).toBe("UTM 60");
    expect(gridZoneAt(180, 10).name).toBe("UTM 1");
    expect(gridZoneAt(-180, 10).name).toBe("UTM 1");
    expect(gridZoneAt(-179.99, -10)).toMatchObject({
      name: "UTM 1",
      epsg: 32701,
    });
  });

  // Mutation: wrap the box's edges before computing the zone range.
  it("covers a box panned past 180° with unwrapped zone edges", () => {
    const zones = gridZonesFor({ west: 179, south: 9, east: 181, north: 11 });
    expect(zones.map((z) => [z.name, z.west, z.east])).toEqual([
      ["UTM 60", 174, 180],
      ["UTM 1", 180, 186],
    ]);
    // PROJ: EPSG:32601, lat 10, lon 181 (= -179).
    const got = toGrid(10, 181, zones[1]!);
    expect(got.easting).toBeCloseTo(280766.861, 2);
    expect(got.northing).toBeCloseTo(1106077.13, 2);
  });

  // Mutation: `box.south < 0` in place of the centre's latitude.
  it("takes the hemisphere from the box's centre", () => {
    const box = { west: 12.5, east: 13.5, south: -1, north: 3 };
    expect(gridZonesFor(box)[0]!.epsg).toBe(32633);
    expect(gridZonesFor({ ...box, south: -5 })[0]!.epsg).toBe(32733);
  });

  // Mutation: drop the `- 1` in the `Math.ceil` for the last zone, and the
  // box ending on 12 °E lists zone 33 too. The no-width box is also pinned in
  // the MGA test below, which names its own mutation.
  it("gives one zone to a box that ends on a zone edge or has no width", () => {
    expect(
      gridZonesFor({ west: 6, east: 12, south: 45, north: 46 }).map(
        (z) => z.name,
      ),
    ).toEqual(["UTM 32"]);
    expect(
      gridZonesFor({ west: 12, east: 12, south: 45, north: 45 }).map(
        (z) => z.name,
      ),
    ).toEqual(["UTM 33"]);
  });
});

describe("a longitude in another world copy", () => {
  // MapLibre reports a view panned west past -180 as -210 for 150 °E.
  // Mutation: pick the zone by the raw longitude and -210 reads MGA 54.
  it("picks NSW's zone by the wrapped longitude and answers in its own copy", () => {
    const zone = gridZoneAt(-209.7, -33.7);
    expect(zone).toMatchObject({ grid: "mga2020", name: "MGA 56", epsg: 7856 });
    expect([zone.west, zone.east]).toEqual([-210, Infinity]);
    expect(zone.centralMeridian).toBe(153 - 360);
    expect(gridZoneAt(-216.1, -33.7).name).toBe("MGA 54");
    expect(gridZoneAt(150.3 + 360, -33.7).name).toBe("MGA 56");
  });

  // Mutation: filter the zones against the unshifted box and none match.
  it("lists NSW's zones with their edges in the box's copy", () => {
    const edges = (west: number, east: number) =>
      gridZonesFor({ west, east, south: -33.7, north: -33.6 }).map((z) => [
        z.name,
        z.west,
        z.east,
      ]);
    expect(edges(-210.1, -209.9)).toEqual([
      ["MGA 55", -216, -210],
      ["MGA 56", -210, Infinity],
    ]);
    expect(edges(149.9 + 360, 150.1 + 360)).toEqual([
      ["MGA 55", 504, 510],
      ["MGA 56", 510, Infinity],
    ]);
  });

  // 150.3 - wrapLon(150.3) is about 6e-14, not 0.
  // Mutation: shift by that difference unrounded and the declared edges and
  // meridian come back nudged, and these exact comparisons fail.
  it("hands back an ordinary longitude's zone with its declared edges", () => {
    const zone = gridZoneAt(150.3, -33.7);
    expect([zone.west, zone.east, zone.centralMeridian]).toEqual([
      150,
      Infinity,
      153,
    ]);
    const [z55, z56] = gridZonesFor({
      west: 149.9,
      east: 150.1,
      south: -33.7,
      north: -33.6,
    });
    expect([z55!.west, z55!.east, z55!.centralMeridian]).toEqual([
      144, 150, 147,
    ]);
    expect([z56!.west, z56!.east, z56!.centralMeridian]).toEqual([
      150,
      Infinity,
      153,
    ]);
  });

  // Mutation: look the MGA zone up by the raw longitude.
  it("takes the same grid and coordinates as the wrapped copy", () => {
    const here = toGridAt(-33.7, 150.3);
    const there = toGridAt(-33.7, 150.3 - 360);
    expect(there.zone.name).toBe(here.zone.name);
    expect(there.easting).toBeCloseTo(here.easting, 3);
    expect(there.northing).toBeCloseTo(here.northing, 3);
  });
});

describe("gridZonesFor", () => {
  // Mutation: delete the `box.west === box.east` early return, and the filter's
  // strict `<` lists no MGA zone for a box with no width.
  it("gives a box with no width the one MGA zone at its point", () => {
    const at = (lon: number) =>
      gridZonesFor({ west: lon, east: lon, south: -33.7, north: -33.7 }).map(
        (z) => z.name,
      );
    expect(at(150.3)).toEqual(["MGA 56"]);
    expect(at(144)).toEqual(["MGA 55"]);
    expect(at(-209.7)).toEqual(["MGA 56"]);
  });

  // Mutation: return only the centre's zone and the far side has no lines.
  it("lists NSW's zones the box touches, west to east", () => {
    const box = (west: number, east: number) => ({
      west,
      east,
      south: -33.7,
      north: -33.6,
    });
    const names = (b: ReturnType<typeof box>) =>
      gridZonesFor(b).map((z) => z.name);
    expect(names(box(150.28, 150.34))).toEqual(["MGA 56"]);
    expect(names(box(143.9, 144.1))).toEqual(["MGA 54", "MGA 55"]);
    expect(names(box(143.9, 150.1))).toEqual(["MGA 54", "MGA 55", "MGA 56"]);
  });

  // Mutation: use the west edge's grid, not the centre's.
  it("draws one grid for a box over two: the centre's", () => {
    const westSeaNz = { west: 160, east: 178, south: -40, north: -38 };
    expect(gridZonesFor(westSeaNz, MADE_UP).map((z) => z.grid)).toEqual([
      "nztm2000",
    ]);
    const mostlySea = { west: 179, east: 190, south: -40, north: -38 };
    expect(
      gridZonesFor(mostlySea, MADE_UP).every((z) => z.grid === "utm"),
    ).toBe(true);
  });
});

describe("gridConvergence", () => {
  // Mutation: use `lon` in place of `lon - zone.centralMeridian`.
  it("is ~0 on a zone's central meridian", () => {
    expect(Math.abs(gridConvergence(-33, 153, mgaZone(56)))).toBeLessThan(0.01);
    expect(gridConvergence(45, -111, gridZoneAt(-111, 45))).toBeCloseTo(0, 6);
    expect(
      gridConvergence(-41, 173, gridZoneAt(173, -41, MADE_UP)),
    ).toBeCloseTo(0, 6);
  });

  // Mutation: drop the sin(lat) factor and the sign no longer flips south.
  it("is east of the meridian positive in the north, negative in the south, and flips west of it", () => {
    expect(gridConvergence(45, -109, gridZoneAt(-109, 45))).toBeCloseTo(
      1.41,
      1,
    );
    expect(gridConvergence(-45, -109, gridZoneAt(-109, -45))).toBeCloseTo(
      -1.41,
      1,
    );
    expect(gridConvergence(-33, 155, mgaZone(56))).toBeLessThan(-0.1);
    expect(
      gridConvergence(-41, 175, gridZoneAt(175, -41, MADE_UP)),
    ).toBeLessThan(0);
    expect(gridConvergence(45, -113, gridZoneAt(-113, 45))).toBeLessThan(0);
  });

  // UTM 1's meridian is -177; 179.9 is 3.1 degrees west of it. Mutation: drop
  // the wrap in `gridConvergence` and the offset reads 356.9 degrees.
  it("measures across 180°", () => {
    const zone = gridZoneAt(-179.9, 10);
    expect(zone.centralMeridian).toBe(-177);
    expect(gridConvergence(10, 179.9, zone)).toBeCloseTo(
      -3.1 * Math.sin((10 * Math.PI) / 180),
      6,
    );
  });
});

// Mutation: add a second region to `REGIONS`.
it("is NSW's alone in prod", () => {
  expect(REGIONS).toEqual([NSW_REGION]);
});
