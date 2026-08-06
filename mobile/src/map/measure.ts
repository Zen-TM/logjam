// Measure tool — pure maths behind the tap-to-measure overlay (MeasurePanel +
// the MapScreen wiring). Kept out of the screen so the running total can be
// tested without a map.
//
// DISTANCE ONLY, deliberately. This tool used to read a point's height off the
// contour lines rendered under the tap, because the app carries no DEM and
// sending tapped coordinates to a third-party elevation service would put
// canyon positions on someone else's server (root CLAUDE.md privacy rules).
// That reading only worked inside a generated topo footprint with a vector
// overlay switched on, and was quantised to the contour interval — a confident
// number over a narrow slice of ground and nothing everywhere else.
//
// A statewide DEM is coming. When it lands, gain/loss and an elevation profile
// should be DERIVED ON DEMAND from the point list plus the DEM, through one
// shared helper serving this tool, route detail and any export — never stored
// on a point, which would go stale the moment the point moved.
import { haversineMeters } from "@logjam/shared";

export type MeasurePoint = {
  /** Stable across undo/append. */
  id: number;
  longitude: number;
  latitude: number;
};

export type MeasureStats = {
  distanceM: number;
};

/** Running total for the placed points, in order. */
export function measureStats(points: readonly MeasurePoint[]): MeasureStats {
  let distanceM = 0;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    distanceM += haversineMeters(
      from.latitude,
      from.longitude,
      to.latitude,
      to.longitude,
    );
  }
  return { distanceM };
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
