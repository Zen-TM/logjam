import proj4 from "proj4";
import { describe, expect, it } from "vitest";

import { resolveCrs } from "./crs";
import { GeoPdfParseError } from "./parseGeoref";

const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

// The exact PROJCS WKT carried by NSW Spatial Services topo sheets
// (ESRI-flavour WKT1, GDA2020 / MGA zone 56 — public CRS definition).
const NSW_MGA2020_Z56_WKT =
  'PROJCS["GDA2020_MGA_Zone_56",GEOGCS["GDA2020",DATUM["GDA2020",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",10000000.0],PARAMETER["Central_Meridian",153.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';

describe("resolveCrs — EPSG table", () => {
  it("resolves the geographic entries", () => {
    for (const epsg of [4326, 4283, 7844]) {
      const r = resolveCrs({ kind: "EPSG_ONLY", epsg });
      expect(r.isGeographic).toBe(true);
      expect(r.isWebMercator).toBe(false);
      expect(r.key).toBe(`EPSG:${epsg}`);
    }
  });

  it("resolves Web Mercator aliases", () => {
    for (const epsg of [3857, 900913]) {
      const r = resolveCrs({ kind: "EPSG_ONLY", epsg });
      expect(r.isWebMercator).toBe(true);
    }
  });

  it("resolves every MGA and UTM-south zone entry to a working projection", () => {
    for (const epsg of [28354, 28355, 28356, 7854, 7855, 7856, 32754, 32755, 32756]) {
      const r = resolveCrs({ kind: "EPSG_ONLY", epsg });
      expect(r.isGeographic).toBe(false);
      const [x, y] = proj4(WGS84, r.def, [150.25, -33.65]);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("prefers the EPSG table over the WKT when both are present", () => {
    const r = resolveCrs({ kind: "PROJCS", wkt: "GARBAGE[", epsg: 28356 });
    expect(r.key).toBe("EPSG:28356");
  });
});

describe("resolveCrs — WKT fallback", () => {
  it("parses the NSW MGA2020 zone 56 PROJCS WKT to within a metre of EPSG:7856", () => {
    const r = resolveCrs({ kind: "PROJCS", wkt: NSW_MGA2020_Z56_WKT });
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
    const r = resolveCrs({
      kind: "GEOGCS",
      wkt: 'GEOGCS["GDA2020",DATUM["GDA2020",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
    });
    expect(r.isGeographic).toBe(true);
  });

  it("throws UNSUPPORTED_CRS on unparseable WKT", () => {
    let caught: unknown;
    try {
      resolveCrs({ kind: "PROJCS", wkt: "COMPLETE GARBAGE" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GeoPdfParseError);
    expect((caught as GeoPdfParseError).code).toBe("UNSUPPORTED_CRS");
  });

  it("throws UNSUPPORTED_CRS on an unknown EPSG with no WKT", () => {
    let caught: unknown;
    try {
      resolveCrs({ kind: "EPSG_ONLY", epsg: 2154 }); // Lambert-93, not in table
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
      resolveCrs({ kind: "PROJCS", epsg: 7855, wkt: NSW_MGA2020_Z56_WKT }),
    ).toThrow(GeoPdfParseError);
  });

  it("accepts an EPSG code the WKT agrees with", () => {
    const resolved = resolveCrs({
      kind: "PROJCS",
      epsg: 7856,
      wkt: NSW_MGA2020_Z56_WKT,
    });
    expect(resolved.key).toBe("EPSG:7856");
  });

  it("keeps the EPSG code when the WKT is unparseable", () => {
    // Junk WKT is not evidence of disagreement; the code stands on its own.
    const resolved = resolveCrs({
      kind: "PROJCS",
      epsg: 7856,
      wkt: "PROJCS[not actually wkt",
    });
    expect(resolved.key).toBe("EPSG:7856");
  });

  it("still resolves an EPSG-only viewport", () => {
    expect(resolveCrs({ kind: "EPSG_ONLY", epsg: 7856 }).key).toBe("EPSG:7856");
  });
});
