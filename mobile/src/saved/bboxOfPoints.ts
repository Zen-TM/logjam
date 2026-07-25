// Pure geometry helper, kept out of SavedScreen.tsx so the unit suite can
// import it without pulling React Native in (see CLAUDE.md testing notes).
export type Bbox = [number, number, number, number];

export function bboxOfPoints(points: { lon: number; lat: number }[]): Bbox | null {
  if (points.length === 0) return null;
  let west = points[0].lon;
  let east = points[0].lon;
  let south = points[0].lat;
  let north = points[0].lat;
  for (const point of points) {
    if (point.lon < west) west = point.lon;
    if (point.lon > east) east = point.lon;
    if (point.lat < south) south = point.lat;
    if (point.lat > north) north = point.lat;
  }
  // A single-point track has zero extent; pad it so fitBounds has something to
  // fit (~100 m at NSW latitudes).
  if (west === east && south === north) {
    return [west - 0.001, south - 0.001, east + 0.001, north + 0.001];
  }
  return [west, south, east, north];
}
