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
    Math.abs(lat1 - lat2) <= degLatLng &&
    Math.abs(lng1 - lng2) <= degLatLng
  );
}
