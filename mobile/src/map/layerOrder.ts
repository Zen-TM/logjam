// Where the map's layers sit relative to each other, decided by NAME.
//
// MLRN's `layerIndex` is a position in whatever stack the style holds when the
// layer mounts, and the native side clamps an index past the end to "just
// under the top layer". A LiDAR overlay switched on after the place pins
// mounted — or mounted before them, when the stack was still short — could
// therefore land above the pins. Anchoring to a layer by id cannot: the layer
// waits for its anchor and is inserted directly below it.
//
// Bottom to top: the bands of `BAND_MARKERS`, the offline mask, then the ground
// band (topo overlays, GeoPDFs, vector imports), place routes, saved routes,
// recorded tracks, nav line, place pins. The route being drawn is deliberately
// unanchored and stays on top.

import { TERRAIN_BASEMAP_ANCHORS } from "@logjam/shared";

/** Lowest place-pin layer, always mounted: everything but the pins goes below it. Guard: mobile/src/map/layerOrder.test.ts. */
export const PIN_FLOOR = "shared-place-halos";

/** Lowest saved-route layer, always mounted (RoutesLayer never unmounts). Guard: mobile/src/map/layerOrder.test.ts. */
export const ROUTES_FLOOR = "saved-routes-casing";

/**
 * Empty layers of the shell style, bottom to top, each the top of a band of
 * the basemap: a layer goes in directly under its band's marker. Offline there
 * is one basemap stack per saved area, and the Terrain group lies between the
 * layers of a stack (shared TERRAIN_BASEMAP_ANCHORS), so the stacks are mounted
 * band by band, not one above the other: hillshade, slope and contours then lie
 * under the roads and labels of every saved area. A band is filled in mount
 * order, the last on top, so nothing has to remount when a saved area joins.
 * A style reload keeps the bands but can reorder the saved areas inside one,
 * which shows only where saves overlap: they are clips of the same map.
 * Guard: layerOrder.test.ts ("two saved areas and the Terrain group").
 */
export const BAND_MARKERS = {
  /** A raster basemap, or a vector stack's land fills. */
  land: "band-land",
  /** The hillshade. */
  shading: "band-shading",
  /** A vector stack's water fill. */
  water: "band-water",
  /** The slope, and the contours above it. */
  terrain: "band-terrain",
  /** A vector stack's streams, roads, boundaries and labels. */
  top: "band-top",
} as const;

/**
 * The marker of the Terrain layers anchored at a Protomaps layer. Both anchors
 * start a band of the stack, so this is what `terrainBeforeIds` reads where
 * Logjam Web has the layer itself.
 */
export function terrainBandMarker(anchor: string): string {
  return anchor === TERRAIN_BASEMAP_ANCHORS.hillshade
    ? BAND_MARKERS.shading
    : BAND_MARKERS.terrain;
}

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
