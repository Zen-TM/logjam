import type { RegionBbox } from "@logjam/shared";
import type { GeoJsonPolygonal } from "../../topoLayerTypes";

/**
 * Collect every [lng, lat] position out of a GeoJSON geometry's `coordinates`,
 * regardless of nesting depth. A topo footprint is a Polygon for a contiguous
 * capture but a MultiPolygon for a disconnected one — the extra nesting level
 * meant a plain `.flat()` left rings (not positions), so Math.min(...) of arrays
 * produced NaN and fitBounds threw "Invalid LngLat object: (NaN, NaN)". Walking
 * to the numeric leaf pairs handles Polygon, MultiPolygon, and GeometryCollection
 * coordinate shapes alike.
 */
export function collectLngLatPairs(node: unknown): [number, number][] {
  if (!Array.isArray(node)) return [];
  if (typeof node[0] === "number" && typeof node[1] === "number") {
    return [[node[0], node[1]]];
  }
  return node.flatMap(collectLngLatPairs);
}

/** The box around a footprint, or null when it holds no usable position. */
export function footprintBounds(footprint: GeoJsonPolygonal): RegionBbox | null {
  const pairs = collectLngLatPairs(footprint.coordinates).filter(
    ([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat),
  );
  if (pairs.length === 0) return null;
  const lngs = pairs.map(([lng]) => lng);
  const lats = pairs.map(([, lat]) => lat);
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}

/** Whether two boxes overlap (touching counts). A null box never does. */
export function boundsIntersect(a: RegionBbox | null, b: RegionBbox | null): boolean {
  if (!a || !b) return false;
  return a.west <= b.east && b.west <= a.east && a.south <= b.north && b.south <= a.north;
}
