import proj4 from "proj4";
import { describe, expect, it } from "vitest";

import { resolveCrs, type ResolvedCrs } from "./crs";
import { GeoPdfParseError, type GeoPdfCrs } from "./parseGeoref";

const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

// [lon, lat] inside the sheets the NSW cases describe.
const NSW_PROBE: [number, number] = [150.25, -33.65];
const nsw = (crs: GeoPdfCrs): ResolvedCrs => resolveCrs(crs, NSW_PROBE);

// The exact PROJCS WKT carried by NSW Spatial Services topo sheets
// (ESRI-flavour WKT1, GDA2020 / MGA zone 56 — public CRS definition).
const NSW_MGA2020_Z56_WKT =
  'PROJCS["GDA2020_MGA_Zone_56",GEOGCS["GDA2020",DATUM["GDA2020",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",10000000.0],PARAMETER["Central_Meridian",153.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';

describe("resolveCrs — EPSG table", () => {
  it("resolves the geographic entries", () => {
    for (const epsg of [4326, 4283, 7844]) {
      const r = nsw({ kind: "EPSG_ONLY", epsg });
      expect(r.isGeographic).toBe(true);
      expect(r.isWebMercator).toBe(false);
      expect(r.key).toBe(`EPSG:${epsg}`);
    }
  });

  it("resolves Web Mercator aliases", () => {
    for (const epsg of [3857, 900913]) {
      const r = nsw({ kind: "EPSG_ONLY", epsg });
      expect(r.isWebMercator).toBe(true);
    }
  });

  it("resolves every MGA and UTM-south zone entry to a working projection", () => {
    for (const epsg of [
      28354, 28355, 28356, 7854, 7855, 7856, 32754, 32755, 32756,
    ]) {
      const r = nsw({ kind: "EPSG_ONLY", epsg });
      expect(r.isGeographic).toBe(false);
      const [x, y] = proj4(WGS84, r.def, [150.25, -33.65]);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("prefers the EPSG table over the WKT when both are present", () => {
    const r = nsw({ kind: "PROJCS", wkt: "GARBAGE[", epsg: 28356 });
    expect(r.key).toBe("EPSG:28356");
  });
});

describe("resolveCrs — WKT fallback", () => {
  it("parses the NSW MGA2020 zone 56 PROJCS WKT to within a metre of EPSG:7856", () => {
    const r = nsw({ kind: "PROJCS", wkt: NSW_MGA2020_Z56_WKT });
    expect(r.key).toBe("WKT");
    expect(r.isGeographic).toBe(false);
    const probe: [number, number] = [150.125, -34.0625];
    const [x, y] = proj4(WGS84, r.def, probe);
    const utm56 = "+proj=utm +zone=56 +south +ellps=GRS80 +units=m +no_defs";
    const [ex, ey] = proj4(WGS84, utm56, probe);
    expect(Math.abs(x - ex)).toBeLessThan(1);
    expect(Math.abs(y - ey)).toBeLessThan(1);
  });

  it("parses a GEOGCS WKT as geographic", () => {
    const r = nsw({
      kind: "GEOGCS",
      wkt: 'GEOGCS["GDA2020",DATUM["GDA2020",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
    });
    expect(r.isGeographic).toBe(true);
  });

  it("throws UNSUPPORTED_CRS on unparseable WKT", () => {
    let caught: unknown;
    try {
      nsw({ kind: "PROJCS", wkt: "COMPLETE GARBAGE" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GeoPdfParseError);
    expect((caught as GeoPdfParseError).code).toBe("UNSUPPORTED_CRS");
  });

  it("throws UNSUPPORTED_CRS on an unknown EPSG with no WKT", () => {
    let caught: unknown;
    try {
      nsw({ kind: "EPSG_ONLY", epsg: 2154 }); // Lambert-93, not in table
    } catch (err) {
      caught = err;
    }
    expect((caught as GeoPdfParseError).code).toBe("UNSUPPORTED_CRS");
  });
});

describe("resolveCrs — EPSG ↔ WKT cross-check", () => {
  // A zone-56 sheet whose /EPSG says zone 55. The affine still fits its own
  // control points perfectly (it is fitted in the wrong plane), so nothing
  // downstream can catch this — it has to be caught here.
  it("refuses an EPSG code that contradicts the embedded WKT", () => {
    expect(() =>
      nsw({ kind: "PROJCS", epsg: 7855, wkt: NSW_MGA2020_Z56_WKT }),
    ).toThrow(GeoPdfParseError);
  });

  it("accepts an EPSG code the WKT agrees with", () => {
    const resolved = nsw({
      kind: "PROJCS",
      epsg: 7856,
      wkt: NSW_MGA2020_Z56_WKT,
    });
    expect(resolved.key).toBe("EPSG:7856");
  });

  it("keeps the EPSG code when the WKT is unparseable", () => {
    // Junk WKT is not evidence of disagreement; the code stands on its own.
    const resolved = nsw({
      kind: "PROJCS",
      epsg: 7856,
      wkt: "PROJCS[not actually wkt",
    });
    expect(resolved.key).toBe("EPSG:7856");
  });

  it("still resolves an EPSG-only viewport", () => {
    expect(nsw({ kind: "EPSG_ONLY", epsg: 7856 }).key).toBe("EPSG:7856");
  });
});

describe("resolveCrs — EPSG rules", () => {
  const epsgOnly = (epsg: number) =>
    resolveCrs({ kind: "EPSG_ONLY", epsg }, [0, 0]);

  // Easting 500000 on the central meridian is true of every UTM zone; the
  // central meridian of zone z is 6z - 183.
  const onCentralMeridian = (epsg: number, zone: number, lat: number) =>
    proj4(WGS84, epsgOnly(epsg).def, [6 * zone - 183, lat]);

  it.each([
    [32601, 1, 10, 500000],
    [32660, 60, 10, 500000],
    [32701, 1, -10, 500000],
    [32760, 60, -10, 500000],
    [28348, 48, -10, 500000],
    [28358, 58, -10, 500000],
    [7846, 46, -10, 500000],
    [7859, 59, -10, 500000],
    [26901, 1, 10, 500000],
    [26923, 23, 10, 500000],
  ])("EPSG:%i is UTM zone %i", (epsg, zone, lat, easting) => {
    const [x, y] = onCentralMeridian(epsg, zone, lat);
    expect(x).toBeCloseTo(easting, 3);
    // The northing says which hemisphere the zone is in.
    expect(lat > 0 ? y < 5_000_000 : y > 5_000_000).toBe(true);
  });

  it("EPSG:2193 is NZTM2000", () => {
    const [x, y] = proj4(WGS84, epsgOnly(2193).def, [173, 0]);
    expect(x).toBeCloseTo(1_600_000, 3);
    expect(y).toBeCloseTo(10_000_000, 3);
  });

  it("resolves NAD83 and NZGD2000 geographic codes as geographic", () => {
    for (const epsg of [4269, 4167]) {
      expect(epsgOnly(epsg).isGeographic).toBe(true);
    }
  });

  it.each([32600, 32661, 32700, 32761, 28347, 28359, 7845, 7860, 26900, 26924])(
    "does not read EPSG:%i as a UTM zone",
    (epsg) => {
      expect(() => epsgOnly(epsg)).toThrow(GeoPdfParseError);
    },
  );
});

describe("resolveCrs — the probe is where the sheet is", () => {
  // proj4 throws for a point at the antipode of a Lambert azimuthal
  // equal-area centre, so a probe in Sydney cannot validate this WKT.
  const ATLANTIC_LAEA_WKT =
    'PROJCS["Atlantic LAEA",GEOGCS["GRS80 sphere",DATUM["D_GRS80",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Lambert_Azimuthal_Equal_Area"],PARAMETER["latitude_of_center",33.5],PARAMETER["longitude_of_center",-29],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1]]';

  it("accepts a WKT that is undefined in Sydney when the probe is on the sheet", () => {
    const r = resolveCrs(
      { kind: "PROJCS", wkt: ATLANTIC_LAEA_WKT },
      [-29, 33.5],
    );
    expect(r.key).toBe("WKT");
  });

  it("refuses the same WKT when the probe is where it is undefined", () => {
    expect(() =>
      resolveCrs({ kind: "PROJCS", wkt: ATLANTIC_LAEA_WKT }, [151, -33.5]),
    ).toThrow(GeoPdfParseError);
  });

  // A zone-12N sheet whose /EPSG says zone 13N: caught only if the probe is
  // inside the sheet's own zone.
  it("refuses an EPSG code for the wrong UTM zone, probed on the sheet", () => {
    const wkt12n =
      'PROJCS["WGS 84 / UTM zone 12N",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-111],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1]]';
    const probe: [number, number] = [-111.9, 40.7];
    expect(() =>
      resolveCrs({ kind: "PROJCS", epsg: 32613, wkt: wkt12n }, probe),
    ).toThrow(GeoPdfParseError);
    expect(
      resolveCrs({ kind: "PROJCS", epsg: 32612, wkt: wkt12n }, probe).key,
    ).toBe("EPSG:32612");
  });
});
