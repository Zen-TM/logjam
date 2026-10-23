// Where the topo band sits in Logjam Web's style: over the basemap, under
// every track, route and place pin, as on Logjam GPS
// (mobile/src/map/layerOrder.ts). The statewide slope and hillshade cover
// whole areas, and over a route they would tint and shade it. Over the vector
// basemap the Terrain group goes inside the basemap instead, under its roads
// and labels (shared TERRAIN_BASEMAP_ANCHORS).
import { terrainBeforeIds, type TerrainLayerKey } from "@logjam/shared";

/**
 * Lowest track, route or pin layer: the first `Map.tsx` adds on load, and
 * every other one goes on above it. Guard: `layerOrder.test.ts`.
 */
export const TOPO_CEILING = "place-tracks-hit";

/**
 * Stacks the topo entries' layers (`groups`, bottom of the map first) directly
 * under `TOPO_CEILING`, each group's layers in their own order.
 */
export function stackTopoLayers(
  map: {
    getLayer(id: string): unknown;
    moveLayer(id: string, beforeId?: string): unknown;
  },
  groups: readonly (readonly string[])[],
): void {
  let before = map.getLayer(TOPO_CEILING) ? TOPO_CEILING : undefined;
  for (const group of [...groups].reverse()) {
    const present = group.filter((lid) => map.getLayer(lid));
    for (const lid of present) map.moveLayer(lid, before);
    if (present.length > 0) before = present[0];
  }
}

/**
 * Over the vector basemap, moves the Terrain group (`layerIds`, each key's
 * layers bottom first) out of the topo band and into the basemap, under its
 * roads and labels. `prefix` is what Map.tsx puts before a Protomaps id.
 */
export function moveTerrainIntoBasemap(
  map: { moveLayer(id: string, beforeId?: string): unknown },
  layerIds: Readonly<Record<TerrainLayerKey, readonly string[]>>,
  prefix: string,
): void {
  for (const [lid, before] of terrainBeforeIds(layerIds, (id) => prefix + id))
    map.moveLayer(lid, before);
}
