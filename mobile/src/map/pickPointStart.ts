import { readBasemapPreference } from "./basemapPreference";
import type { MapCamera } from "./lastCamera";
import type { BasemapId } from "./sourceResolver";

/** Zoom for a picker opened on a coordinate someone already typed: close enough
 *  to see which side of the creek the point is on. */
export const TYPED_POINT_ZOOM = 15;

/**
 * Where Pick a point opens: on the typed coordinate, else where the main map
 * last looked, else home; and on the user's stored basemap pick, not the id
 * `lastCamera` holds. That one is what the main map drew, which is not the
 * pick wherever the pick is not offered there, and this screen applies
 * `effectiveBasemap` to its own view. Guard: `pickPointStart.test.ts`.
 */
export function pickPointStart(
  initialPoint: { latitude: number; longitude: number } | null,
  lastCamera: MapCamera | null,
  home: { center: readonly [number, number]; zoom: number },
): { center: [number, number]; zoom: number; pickedBasemapId: BasemapId } {
  return {
    center: initialPoint
      ? [initialPoint.longitude, initialPoint.latitude]
      : [...(lastCamera?.center ?? home.center)],
    zoom: initialPoint ? TYPED_POINT_ZOOM : (lastCamera?.zoom ?? home.zoom),
    pickedBasemapId: readBasemapPreference(),
  };
}
