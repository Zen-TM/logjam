import { readFileSync } from "node:fs";
import { join } from "node:path";
import proj4 from "proj4";
import { describe, expect, it } from "vitest";

import { parseGeoPdfGeoref, type GeoPdfViewport } from "./parseGeoref";
import { buildGeoTransform } from "./transform";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, "__fixtures__", name)));

const EXTENT = { north: -33.6, south: -33.7, east: 150.3, west: 150.2 };
const MGA56 = "+proj=utm +zone=56 +south +ellps=GRS80 +units=m +no_defs";
const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

describe("buildGeoTransform — Logjam fixture (GEOGCS → Web Mercator plane)", () => {
  const load = async () => {
    const parsed = await parseGeoPdfGeoref(fixture("logjam-a5.pdf"));
    return buildGeoTransform(parsed.pages[0].viewports[0]);
  };

  it("is an exact affine in the Web Mercator plane", async () => {
    const t = await load();
    expect(t.kind).toBe("affine");
    expect(t.planeIsWebMercator).toBe(true);
    expect(t.planeCrs).toBe("EPSG:3857");
    expect(t.maxResidualFractionOfWidth).toBeLessThan(1e-9);
  });

  it("reproduces the generator extent at the BBox corners", async () => {
    const t = await load();
    const corners: [{ x: number; y: number }, { lon: number; lat: number }][] = [
      [{ x: 28, y: 28 }, { lon: EXTENT.west, lat: EXTENT.south }],
      [{ x: 393, y: 28 }, { lon: EXTENT.east, lat: EXTENT.south }],
      [{ x: 393, y: 270 }, { lon: EXTENT.east, lat: EXTENT.north }],
      [{ x: 28, y: 270 }, { lon: EXTENT.west, lat: EXTENT.north }],
    ];
    for (const [pagePt, lonLat] of corners) {
      const g = t.pageToLonLat(pagePt);
      expect(Math.abs(g.lon - lonLat.lon)).toBeLessThan(1e-9);
      expect(Math.abs(g.lat - lonLat.lat)).toBeLessThan(1e-9);
      const back = t.lonLatToPage(lonLat);
      expect(Math.abs(back.x - pagePt.x)).toBeLessThan(1e-6);
      expect(Math.abs(back.y - pagePt.y)).toBeLessThan(1e-6);
    }
  });

  it("interior points are exact too (page raster is affine in 3857)", async () => {
    const t = await load();
    // Mercator midpoint of the extent, not the lat midpoint.
    const centre = t.pageToLonLat({ x: (28 + 393) / 2, y: (28 + 270) / 2 });
    expect(Math.abs(centre.lon - 150.25)).toBeLessThan(1e-9);
    const [, expectedMercMidLat] = proj4(
      "EPSG:3857",
      WGS84,
      proj4(WGS84, "EPSG:3857", [150.25, EXTENT.south]).map(
        (v, i) =>
          (v + proj4(WGS84, "EPSG:3857", [150.25, EXTENT.north])[i]) / 2,
      ),
    );
    expect(Math.abs(centre.lat - expectedMercMidLat)).toBeLessThan(1e-9);
  });

  it("wgs84Bounds equals the extent", async () => {
    const t = await load();
    expect(t.wgs84Bounds.north).toBeCloseTo(EXTENT.north, 9);
    expect(t.wgs84Bounds.south).toBeCloseTo(EXTENT.south, 9);
    expect(t.wgs84Bounds.east).toBeCloseTo(EXTENT.east, 9);
    expect(t.wgs84Bounds.west).toBeCloseTo(EXTENT.west, 9);
  });
});

describe("buildGeoTransform — legacy Logjam fixture", () => {
  it("recovers the same georef through the quirk path", async () => {
    const parsed = await parseGeoPdfGeoref(fixture("logjam-legacy-a5.pdf"));
    const t = buildGeoTransform(parsed.pages[0].viewports[0]);
    const g = t.pageToLonLat({ x: 28, y: 270 });
    expect(Math.abs(g.lon - EXTENT.west)).toBeLessThan(1e-6);
    expect(Math.abs(g.lat - EXTENT.north)).toBeLessThan(1e-6);
  });
});

describe("buildGeoTransform — GDAL MGA fixture (PROJCS plane)", () => {
  const load = async () => {
    const parsed = await parseGeoPdfGeoref(fixture("gdal-mga56.pdf"));
    return buildGeoTransform(parsed.pages[0].viewports[0]);
  };

  it("fits an affine in the MGA plane with negligible residual", async () => {
    const t = await load();
    expect(t.kind).toBe("affine");
    expect(t.planeIsWebMercator).toBe(false);
    expect(t.planeCrs).toBe("EPSG:28356");
    // GPTS precision limits exactness; the GeoTIFF grid was exact metres.
    expect(t.maxResidualPlaneUnits).toBeLessThan(0.01); // < 1 cm
  });

  it("maps page corners to the GeoTIFF's MGA corners", async () => {
    const t = await load();
    // 64×48 px at 10 m/px, top-left E 250000 N 6270000 (fixture README).
    const cases: [{ x: number; y: number }, [number, number]][] = [
      [{ x: 0, y: 48 }, [250000, 6270000]],
      [{ x: 64, y: 48 }, [250640, 6270000]],
      [{ x: 64, y: 0 }, [250640, 6269520]],
      [{ x: 0, y: 0 }, [250000, 6269520]],
    ];
    for (const [pagePt, [east, north]] of cases) {
      const q = t.pageToPlane(pagePt);
      expect(Math.abs(q.x - east)).toBeLessThan(0.02);
      expect(Math.abs(q.y - north)).toBeLessThan(0.02);
    }
  });

  it("pageToLonLat cross-checks against direct proj4 MGA→WGS84", async () => {
    const t = await load();
    const q = { x: 250320, y: 6269760 }; // centre of the raster in MGA
    const [lon, lat] = proj4(MGA56, WGS84, [q.x, q.y]);
    const g = t.pageToLonLat(t.planeToPage(q));
    expect(Math.abs(g.lon - lon)).toBeLessThan(1e-9);
    expect(Math.abs(g.lat - lat)).toBeLessThan(1e-9);
  });

  it("pageToMercator composes MGA → WGS84 → 3857", async () => {
    const t = await load();
    const pagePt = { x: 32, y: 24 };
    const g = t.pageToLonLat(pagePt);
    const [mx, my] = proj4(WGS84, "EPSG:3857", [g.lon, g.lat]);
    const m = t.pageToMercator(pagePt);
    expect(Math.abs(m.x - mx)).toBeLessThan(1e-6);
    expect(Math.abs(m.y - my)).toBeLessThan(1e-6);
    const back = t.mercatorToPage(m);
    expect(Math.abs(back.x - pagePt.x)).toBeLessThan(1e-6);
    expect(Math.abs(back.y - pagePt.y)).toBeLessThan(1e-6);
  });
});

describe("buildGeoTransform — homography fallback on a keystone georef", () => {
  // Synthetic viewport whose 4 control points are NOT an affine image:
  // a trapezoid in the plane against a rectangle in page space.
  const keystoneVp = (): GeoPdfViewport => {
    const pagePts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    // Plane (3857) targets: bottom edge wider than top — pure keystone.
    const planePts = [
      { x: 16720000, y: -3990000 },
      { x: 16730000, y: -3990000 },
      { x: 16729000, y: -3980000 },
      { x: 16721000, y: -3980000 },
    ];
    const controlPoints = pagePts.map((pagePt, i) => {
      const [lon, lat] = proj4("EPSG:3857", WGS84, [planePts[i].x, planePts[i].y]);
      return { pagePt, lonLat: { lon, lat } };
    });
    return {
      bboxPt: { x0: 0, y0: 0, x1: 100, y1: 100 },
      controlPoints,
      crs: { kind: "EPSG_ONLY", epsg: 4326 },
      quirks: [],
    };
  };

  it("upgrades to a homography and nails all four corners", () => {
    const t = buildGeoTransform(keystoneVp());
    expect(t.kind).toBe("homography");
    expect(t.maxResidualPlaneUnits).toBeLessThan(1e-4);
    const vp = keystoneVp();
    for (const cp of vp.controlPoints) {
      const g = t.pageToLonLat(cp.pagePt);
      expect(Math.abs(g.lon - cp.lonLat.lon)).toBeLessThan(1e-9);
      expect(Math.abs(g.lat - cp.lonLat.lat)).toBeLessThan(1e-9);
      const back = t.lonLatToPage(cp.lonLat);
      expect(Math.abs(back.x - cp.pagePt.x)).toBeLessThan(1e-6);
      expect(Math.abs(back.y - cp.pagePt.y)).toBeLessThan(1e-6);
    }
  });
});
