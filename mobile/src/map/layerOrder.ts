// Where the map's layers sit relative to each other, decided by NAME.
//
// MLRN's `layerIndex` is a position in whatever stack the style holds when the
// layer mounts, and the native side clamps an index past the end to "just
// under the top layer". A LiDAR overlay switched on after the place pins
// mounted — or mounted before them, when the stack was still short — could
// therefore land above the pins. Anchoring to a layer by id cannot: the layer
// waits for its anchor and is inserted directly below it.
//
// Bottom to top: basemap, offline mask (both by index, see MapScreen), then
// the ground band (topo overlays, GeoPDFs, vector imports), place routes,
// saved routes, recorded tracks, nav line, place pins. The route being drawn
// is deliberately unanchored and stays on top.

/** Lowest place-pin layer, always mounted: everything but the pins goes below it. */
export const PIN_FLOOR = "shared-place-halos";

/** Lowest saved-route layer, always mounted (RoutesLayer never unmounts). */
export const ROUTES_FLOOR = "saved-routes-casing";

/**
 * `beforeId` for each id of a stack listed bottom to top: every layer goes
 * directly under the next one, the last under `anchor`. Mount order then no
 * longer matters, which is the point — a layer added later slots into place.
 */
export function chainBeforeIds(
  ids: readonly string[],
  anchor: string,
): Record<string, string> {
  return Object.fromEntries(ids.map((id, i) => [id, ids[i + 1] ?? anchor]));
}
