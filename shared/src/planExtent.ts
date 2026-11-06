/**
 * The box around everything a plan puts on the map: its places and every point
 * of its routes. Null when it has none. Each client pads it its own way (a
 * region of interest is never stored, so this is built at open time).
 */
export function planExtent(plan: {
  places: readonly { latitude: number; longitude: number }[];
  routes: readonly { points: readonly (readonly [number, number])[] }[];
}): { west: number; south: number; east: number; north: number } | null {
  const points = [
    ...plan.places.map((p) => [p.longitude, p.latitude] as const),
    ...plan.routes.flatMap((r) => r.points),
  ];
  if (points.length === 0) return null;
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  return {
    west: Math.min(...lons),
    south: Math.min(...lats),
    east: Math.max(...lons),
    north: Math.max(...lats),
  };
}
