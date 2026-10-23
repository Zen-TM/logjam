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

/** Lowest place-pin layer, always mounted: everything but the pins goes below it. Guard: mobile/src/map/layerOrder.test.ts. */
export const PIN_FLOOR = "shared-place-halos";

/** Lowest saved-route layer, always mounted (RoutesLayer never unmounts). Guard: mobile/src/map/layerOrder.test.ts. */
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

/**
 * The React key suffixes of the basemap stacks and of the Terrain group, so a
 * change in which basemaps are drawn remounts the stacks, and the Terrain
 * group too when the vector map is among them. MLRN moves a mounted
 * layer only when its own `beforeId` changes, and a stack added later goes in
 * under every layer already on the map (its `layerIndex` counts from the
 * bottom). Without the remount, after a switch from imagery to the vector
 * map the contour lines, still chained to each other, stay over its roads
 * and labels; and offline, a newly saved area's stack, the one the Terrain
 * group anchors in, mounts under an older one's opaque background. Mounted
 * together, the stacks go in `basemaps` order, the first on top.
 * Guard: layerOrder.test.ts ("basemapMountKeys", and "MapScreen keys its
 * stacks and the Terrain group by basemapMountKeys").
 */
export function basemapMountKeys(
  basemaps: readonly { key: string; sourceType: string }[],
): { stacks: string; terrain: string } {
  const stacks = basemaps.map((b) => b.key).join("+");
  return {
    stacks,
    terrain: basemaps.some((b) => b.sourceType === "vector")
      ? stacks
      : "ground",
  };
}
