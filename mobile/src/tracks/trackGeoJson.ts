// Pure: stored track points → GeoJSON for MLRN. Segments become separate
// line strings so the rendered track breaks across pause gaps instead of
// drawing a teleport line.
import type { RecordedTrackPoint } from "@logjam/shared";

export type TrackMultiLineString = {
  type: "Feature";
  geometry: { type: "MultiLineString"; coordinates: [number, number][][] };
  properties: Record<string, never>;
};

export function trackPointsToFeature(
  points: RecordedTrackPoint[],
): TrackMultiLineString {
  const coordinates: [number, number][][] = [];
  let current: [number, number][] = [];
  let segment: number | null = null;
  for (const point of points) {
    if (segment !== null && point.segment !== segment) {
      // A 1-point segment cannot render as a line — drop it.
      if (current.length >= 2) coordinates.push(current);
      current = [];
    }
    segment = point.segment;
    current.push([point.lon, point.lat]);
  }
  if (current.length >= 2) coordinates.push(current);
  return {
    type: "Feature",
    geometry: { type: "MultiLineString", coordinates },
    properties: {},
  };
}
