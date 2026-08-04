// Measure tool — pure maths behind the tap-to-measure overlay (MeasurePanel +
// the MapScreen wiring). Kept out of the screen so the running totals and the
// elevation lookup can be tested without a map.
//
// ELEVATION CEILING (deliberate, see the tool's header comment in MapScreen):
// the app carries no DEM and the API has no elevation endpoint, and sending
// tapped coordinates to a third-party elevation service would put canyon
// positions on someone else's server (root CLAUDE.md privacy rules). So a
// point's height is read off the CONTOUR LINES already rendered under the tap —
// which means it is only available where a VECTOR topo overlay is switched on,
// and it is quantised to the contour interval. Points with no contour nearby
// carry `elevationM: null` and are skipped by the gain/loss sum.
import { haversineMeters } from "@logjam/shared";

export type MeasurePoint = {
  /** Stable across undo/append — the elevation lookup patches by id. */
  id: number;
  longitude: number;
  latitude: number;
  /** Metres, from the nearest rendered contour; null when none was found. */
  elevationM: number | null;
};

export type MeasureStats = {
  distanceM: number;
  /** Null when no two consecutive points both carry an elevation. */
  gainM: number | null;
  lossM: number | null;
  /** False when at least one point has no contour height — gain/loss is partial. */
  elevationComplete: boolean;
};

/** Running totals for the placed points, in order. */
export function measureStats(points: readonly MeasurePoint[]): MeasureStats {
  let distanceM = 0;
  let gainM = 0;
  let lossM = 0;
  let elevationPairs = 0;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    distanceM += haversineMeters(
      from.latitude,
      from.longitude,
      to.latitude,
      to.longitude,
    );
    if (from.elevationM != null && to.elevationM != null) {
      const delta = to.elevationM - from.elevationM;
      if (delta > 0) gainM += delta;
      else lossM -= delta;
      elevationPairs++;
    }
  }
  return {
    distanceM,
    gainM: elevationPairs > 0 ? gainM : null,
    lossM: elevationPairs > 0 ? lossM : null,
    elevationComplete:
      points.length < 2 || points.every((point) => point.elevationM != null),
  };
}

/**
 * Height at (lon, lat) from contour features rendered around it: the `elev` of
 * whichever contour VERTEX is nearest.
 *
 * ponytail: nearest vertex, not nearest point on the segment, and no
 * interpolation between the two contours the tap sits between. LAZ-derived
 * contours are dense enough that the vertex is within a few metres of the line,
 * and the answer is quantised to the contour interval either way — upgrade to
 * segment projection + interpolation only if the readout proves too coarse.
 */
export function nearestContourElevation(
  features: readonly GeoJSON.Feature[],
  longitude: number,
  latitude: number,
): number | null {
  // Planar comparison is fine for ranking candidates inside one tap-sized rect;
  // scale longitude so a degree of each axis is comparable at this latitude.
  const lonScale = Math.cos((latitude * Math.PI) / 180);
  let bestElevation: number | null = null;
  let bestDistanceSq = Infinity;
  for (const feature of features) {
    const elevation = readElevation(feature.properties);
    if (elevation == null) continue;
    for (const [lon, lat] of vertices(feature.geometry)) {
      const dx = (lon - longitude) * lonScale;
      const dy = lat - latitude;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestElevation = elevation;
      }
    }
  }
  return bestElevation;
}

/** Tile properties arrive as numbers or numeric strings depending on encoder. */
function readElevation(properties: GeoJSON.GeoJsonProperties): number | null {
  const raw = properties?.elev;
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function* vertices(geometry: GeoJSON.Geometry): Generator<[number, number]> {
  switch (geometry.type) {
    case "Point":
      yield geometry.coordinates as [number, number];
      return;
    case "LineString":
    case "MultiPoint":
      yield* geometry.coordinates as [number, number][];
      return;
    case "MultiLineString":
    case "Polygon":
      for (const part of geometry.coordinates) {
        yield* part as [number, number][];
      }
      return;
    case "MultiPolygon":
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) yield* ring as [number, number][];
      }
      return;
    case "GeometryCollection":
      for (const part of geometry.geometries) yield* vertices(part);
      return;
  }
}

/** GeoJSON for the dotted line + its vertices. */
export function measureShape(
  points: readonly MeasurePoint[],
): GeoJSON.FeatureCollection {
  const coordinates = points.map((point) => [point.longitude, point.latitude]);
  return {
    type: "FeatureCollection",
    features: [
      ...(coordinates.length >= 2
        ? [
            {
              type: "Feature" as const,
              geometry: { type: "LineString" as const, coordinates },
              properties: {},
            },
          ]
        : []),
      ...coordinates.map((coordinate) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: coordinate },
        properties: {},
      })),
    ],
  };
}
