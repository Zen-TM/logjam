import { describe, expect, it } from "vitest";
import {
  MAX_ROUTE_POINTS,
  ROUTE_ERRORS,
  parseRoutePoints,
  validateRoutePayload,
  routeLengthM,
  routeToGeoJson,
  reverseRoute,
  reverseRouteAnchors,
  simplifyRoute,
  simplifyToFit,
  routesFromVectorImport,
  type RoutePoint,
} from "./routeValidation.js";
import { IMPORT_ERRORS, type VectorImportResult } from "./vectorImport.js";

const CLAUSTRAL: RoutePoint = [150.4033, -33.5603];

/** A straight-ish line of `count` points heading east from Claustral. */
function line(count: number, stepDeg = 0.0005): RoutePoint[] {
  return Array.from({ length: count }, (_, i): RoutePoint => [
    CLAUSTRAL[0] + i * stepDeg,
    CLAUSTRAL[1],
  ]);
}

describe("parseRoutePoints", () => {
  it("accepts a valid pair list and rounds to 6 dp", () => {
    const parsed = parseRoutePoints([
      [150.40331234567, -33.5603],
      [150.41, -33.56],
    ]);
    expect(parsed).toEqual({
      points: [
        [150.403312, -33.5603],
        [150.41, -33.56],
      ],
    });
  });

  it("drops a third element (elevation is derived, never stored)", () => {
    const parsed = parseRoutePoints([
      [150.4033, -33.5603, 812],
      [150.41, -33.56, 795],
    ]);
    expect("points" in parsed && parsed.points).toEqual([
      [150.4033, -33.5603],
      [150.41, -33.56],
    ]);
  });

  it("rejects fewer than two points", () => {
    expect(parseRoutePoints([[150.4, -33.5]])).toEqual({
      error: ROUTE_ERRORS.tooFewPoints,
    });
  });

  it("rejects more than MAX_ROUTE_POINTS", () => {
    expect(parseRoutePoints(line(MAX_ROUTE_POINTS + 1))).toEqual({
      error: ROUTE_ERRORS.tooManyPoints,
    });
  });

  it("accepts exactly MAX_ROUTE_POINTS", () => {
    const parsed = parseRoutePoints(line(MAX_ROUTE_POINTS));
    expect("points" in parsed && parsed.points).toHaveLength(MAX_ROUTE_POINTS);
  });

  it("rejects a non-array and malformed pairs", () => {
    expect(parseRoutePoints("nope")).toEqual({ error: ROUTE_ERRORS.pointsShape });
    expect(parseRoutePoints([[150.4, -33.5], [150.4]])).toEqual({
      error: ROUTE_ERRORS.pointsShape,
    });
  });

  it("rejects out-of-range coordinates", () => {
    // [lon, lat] — a latitude of 150 is the classic swapped-axis mistake.
    const parsed = parseRoutePoints([
      [-33.5, 150.4],
      [-33.6, 150.5],
    ]);
    expect("error" in parsed && parsed.error).toContain("Latitude");
  });

  it("never echoes a coordinate value in an error", () => {
    const parsed = parseRoutePoints([
      [999.123456, -33.5],
      [150.4, -33.6],
    ]);
    expect("error" in parsed && parsed.error).not.toContain("999");
  });
});

describe("validateRoutePayload", () => {
  const points = line(3);

  it("passes a valid create payload", () => {
    expect(
      validateRoutePayload({ name: "Approach", points }, { requireCore: true }),
    ).toBeNull();
  });

  it("requires name and points on create", () => {
    expect(validateRoutePayload({ points }, { requireCore: true })).toBe(
      ROUTE_ERRORS.nameRequired,
    );
    expect(
      validateRoutePayload({ name: "Approach" }, { requireCore: true }),
    ).toBe(ROUTE_ERRORS.pointsRequired);
  });

  it("rejects a blank or over-long name", () => {
    expect(
      validateRoutePayload({ name: "   ", points }, { requireCore: true }),
    ).toBe(ROUTE_ERRORS.nameRequired);
    expect(
      validateRoutePayload({ name: "x".repeat(201), points }, { requireCore: true }),
    ).toBe(ROUTE_ERRORS.nameTooLong);
  });

  it("validates only supplied fields on patch", () => {
    expect(validateRoutePayload({}, { requireCore: false })).toBeNull();
    expect(validateRoutePayload({ name: "Exit" }, { requireCore: false })).toBeNull();
    expect(validateRoutePayload({ points: [] }, { requireCore: false })).toBe(
      ROUTE_ERRORS.tooFewPoints,
    );
  });
});

describe("routeLengthM", () => {
  it("sums leg distances", () => {
    // One degree of longitude at -33.56 is ~92.7 km; 0.0005 deg ≈ 46 m.
    const length = routeLengthM(line(3));
    expect(length).toBeGreaterThan(80);
    expect(length).toBeLessThan(110);
  });

  it("is zero for a single point", () => {
    expect(routeLengthM([CLAUSTRAL])).toBe(0);
  });
});

describe("routeToGeoJson / reverseRoute", () => {
  it("emits one LineString feature with the given properties", () => {
    const feature = routeToGeoJson(line(3), { color: "#e6194b" });
    expect(feature.geometry.type).toBe("LineString");
    expect(feature.geometry.coordinates).toHaveLength(3);
    expect(feature.properties).toEqual({ color: "#e6194b" });
  });

  it("reverses order without mutating the input", () => {
    const points = line(3);
    const reversed = reverseRoute(points);
    expect(reversed[0]).toEqual(points[2]);
    expect(points[0]).toEqual(CLAUSTRAL);
  });

  it("reverses anchor indices so they still point at the same vertices", () => {
    const points = line(6);
    // The user placed the ends and one middle vertex; the rest is snapped fill.
    const anchors = [0, 2, 5];
    const reversed = reverseRouteAnchors(anchors, points.length);
    expect(reversed).toEqual([0, 3, 5]);
    const reversedPoints = reverseRoute(points);
    for (const [i, index] of reversed.entries()) {
      expect(reversedPoints[index]).toEqual(points[anchors[anchors.length - 1 - i]!]);
    }
  });
});

describe("simplifyRoute", () => {
  it("keeps both endpoints and drops collinear middles", () => {
    const simplified = simplifyRoute(line(50), 5);
    expect(simplified[0]).toEqual(CLAUSTRAL);
    expect(simplified.at(-1)).toEqual(line(50).at(-1));
    expect(simplified.length).toBeLessThan(50);
  });

  it("keeps a vertex that deviates beyond the tolerance", () => {
    // A ~55 m northward spike in the middle of an otherwise straight line.
    const points: RoutePoint[] = [
      [150.4033, -33.5603],
      [150.4038, -33.5598],
      [150.4043, -33.5603],
    ];
    expect(simplifyRoute(points, 10)).toHaveLength(3);
    expect(simplifyRoute(points, 200)).toHaveLength(2);
  });

  it("is a no-op below three points or at zero tolerance", () => {
    const two = line(2);
    expect(simplifyRoute(two, 100)).toEqual(two);
    expect(simplifyRoute(line(10), 0)).toHaveLength(10);
  });

  it("handles a recording-sized input iteratively (no stack overflow)", () => {
    // The recursive formulation overflows here; this one is stack-free.
    const track: RoutePoint[] = Array.from({ length: 20_000 }, (_, i) => [
      CLAUSTRAL[0] + i * 0.00001,
      CLAUSTRAL[1] + Math.sin(i / 30) * 0.0002,
    ]);
    expect(() => simplifyRoute(track, 2)).not.toThrow();
  });
});

describe("simplifyToFit", () => {
  it("returns input untouched when already under the cap", () => {
    const points = line(10);
    const result = simplifyToFit(points);
    expect(result.toleranceM).toBe(0);
    expect(result.droppedCount).toBe(0);
    expect(result.points).toEqual(points);
  });

  it("fits a recording-sized track under the cap", () => {
    // ~4000 points with real wiggle, the shape of a big canyoning day.
    const track: RoutePoint[] = Array.from({ length: 4000 }, (_, i) => [
      CLAUSTRAL[0] + i * 0.00002,
      CLAUSTRAL[1] + Math.sin(i / 40) * 0.0004,
    ]);
    const result = simplifyToFit(track);
    expect(result.points.length).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
    expect(result.points.length).toBeGreaterThan(2);
    expect(result.toleranceM).toBeGreaterThan(0);
    expect(result.droppedCount).toBe(4000 - result.points.length);
    // Endpoints survive — the route still starts and ends where the trip did.
    expect(result.points[0]).toEqual(track[0]);
    expect(result.points.at(-1)).toEqual(track.at(-1));
  });

  it("honours an explicit smaller cap", () => {
    const result = simplifyToFit(line(500), 50);
    expect(result.points.length).toBeLessThanOrEqual(50);
  });

  it("bounds a pathological import without hanging", () => {
    // A tight zigzag against a small tolerance is RDP's quadratic worst case,
    // and an import may legitimately carry MAX_IMPORT_POSITIONS. The
    // pre-decimation in simplifyToFit is what keeps this tractable.
    const zigzag: RoutePoint[] = Array.from({ length: 200_000 }, (_, i) => [
      CLAUSTRAL[0] + i * 0.000001,
      CLAUSTRAL[1] + (i % 2) * 0.00001,
    ]);
    const started = Date.now();
    const result = simplifyToFit(zigzag);
    expect(result.points.length).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
    expect(result.droppedCount).toBe(200_000 - result.points.length);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("routesFromVectorImport", () => {
  const bbox: [number, number, number, number] = [150.4, -33.57, 150.41, -33.55];

  function importResult(
    features: VectorImportResult["features"],
    name: string | null = null,
  ): VectorImportResult {
    return {
      name,
      features,
      bbox,
      stats: { points: 0, lines: 0, polygons: 0, positions: 0 },
    };
  }

  it("makes one route per track in a multi-track file", () => {
    const plan = routesFromVectorImport(
      importResult([
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: line(5) },
          properties: { name: "Approach" },
        },
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: line(4) },
          properties: { name: "Exit" },
        },
      ]),
    );
    expect(plan.drafts).toHaveLength(2);
    expect(plan.drafts.map((d) => d.name)).toEqual(["Approach", "Exit"]);
  });

  it("splits a MultiLineString into separate routes", () => {
    const plan = routesFromVectorImport(
      importResult([
        {
          type: "Feature",
          geometry: { type: "MultiLineString", coordinates: [line(3), line(4)] },
          properties: {},
        },
      ]),
    );
    expect(plan.drafts).toHaveLength(2);
  });

  it("drops polygons and lone points, and counts them", () => {
    const plan = routesFromVectorImport(
      importResult([
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: line(3) },
          properties: {},
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [150.4, -33.56] },
          properties: {},
        },
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [line(4)] },
          properties: {},
        },
      ]),
    );
    expect(plan.drafts).toHaveLength(1);
    expect(plan.dropped).toEqual({ points: 1, polygons: 1 });
  });

  it("flags an over-cap line rather than simplifying it", () => {
    const plan = routesFromVectorImport(
      importResult([
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: line(MAX_ROUTE_POINTS + 500) },
          properties: {},
        },
      ]),
    );
    expect(plan.drafts[0]!.overCap).toBe(true);
    expect(plan.drafts[0]!.originalPointCount).toBe(MAX_ROUTE_POINTS + 500);
    // Untouched — the caller offers simplify-or-keep.
    expect(plan.drafts[0]!.points).toHaveLength(MAX_ROUTE_POINTS + 500);
  });

  it("falls back to the document name for an anonymous line", () => {
    const plan = routesFromVectorImport(
      importResult(
        [
          {
            type: "Feature",
            geometry: { type: "LineString", coordinates: line(3) },
            properties: {},
          },
        ],
        "Claustral 2026",
      ),
    );
    expect(plan.drafts[0]!.name).toBe("Claustral 2026");
  });

  it("throws the static noFeatures error when nothing line-shaped survives", () => {
    expect(() =>
      routesFromVectorImport(
        importResult([
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [150.4, -33.56] },
            properties: {},
          },
        ]),
      ),
    ).toThrow(IMPORT_ERRORS.noFeatures);
  });

  it("ignores a degenerate one-vertex line", () => {
    const plan = routesFromVectorImport(
      importResult([
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: line(3) },
          properties: {},
        },
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: line(1) },
          properties: {},
        },
      ]),
    );
    expect(plan.drafts).toHaveLength(1);
  });
});
