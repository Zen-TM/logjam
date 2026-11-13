const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

// Coarse pre-filter before haversine. ±degLatLng on both axes. ~0.05° ≈ 5 km
// at NSW latitudes; pick larger than your auto-link/review radius.
export function withinBbox(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  degLatLng: number,
): boolean {
  return (
    Math.abs(lat1 - lat2) <= degLatLng && Math.abs(lng1 - lng2) <= degLatLng
  );
}

/**
 * Whether a stored longitude, always in [-180, 180], lies in the box between
 * `west` and `east`, inclusive, across the date line.
 *
 * The box arrives in one of two shapes: unwrapped, as MapLibre reports a view
 * panned past the line (an edge below -180 or above 180, possibly a whole
 * world copy away), or wrapped, with `west` above `east`. A box a turn or more
 * wide holds every longitude. Guard: placeGeo.test.ts.
 */
export function lonWithin(lon: number, west: number, east: number): boolean {
  if (west > east) return lon >= west || lon <= east;
  // The copy of `lon` nearest above `west`, whatever world copy the box is in.
  return lon + 360 * Math.ceil((west - lon) / 360) <= east;
}
