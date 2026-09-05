import type { PlaceMarker } from "@logjam/shared";

/**
 * Minimal place shape needed to build a GeoPDF marker — keeps this module a
 * pure transform with no dependency on the full TPlace API type.
 */
export interface MarkerPlace {
  latitude: number;
  longitude: number;
  name: string;
}

export interface MarkerExtent {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Pure builder for the place-name markers baked into a GeoPDF export
 * (PRIV-006). The privacy boundary lives here: places shared by friends are
 * only ever included when the user explicitly opted in via includeShared —
 * a GeoPDF is a printable, hand-to-a-mate artifact, exactly the NPWS
 * publicising vector the root CLAUDE.md export-default rule guards.
 * Extent bounds are inclusive on both edges.
 */
export function buildPlaceMarkers(
  owned: MarkerPlace[] | undefined,
  shared: MarkerPlace[] | undefined,
  extent: MarkerExtent,
  options: { includeOwned: boolean; includeShared: boolean },
): PlaceMarker[] {
  const inExtent = (c: MarkerPlace): boolean =>
    c.latitude >= extent.south &&
    c.latitude <= extent.north &&
    c.longitude >= extent.west &&
    c.longitude <= extent.east;

  const markers: PlaceMarker[] = [];
  if (options.includeOwned && owned) {
    for (const c of owned) {
      if (inExtent(c)) {
        markers.push({
          lat: c.latitude,
          lon: c.longitude,
          name: c.name,
          color: "owned",
        });
      }
    }
  }
  if (options.includeShared && shared) {
    for (const c of shared) {
      if (inExtent(c)) {
        markers.push({
          lat: c.latitude,
          lon: c.longitude,
          name: c.name,
          color: "shared",
        });
      }
    }
  }
  return markers;
}
