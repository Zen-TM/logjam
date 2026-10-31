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
 * The gauge drops go over the topo band and under every pin, so a pin on a
 * gauge is the one pressed. Guard: `layerOrder.test.ts`.
 */
export const GAUGE_LAYER = "gauge-drops";
export const GAUGE_LABELS = "gauge-labels";
export const GAUGE_BELOW = "place-highlight";

/** Everything else on the map with a press of its own. A gauge drop under one
 *  of these is not the thing pressed. */
export const PRESSABLE_LAYERS = [
  "place-circles",
  "shared-place-halos",
  "shared-place-circles",
  "routes-hit",
  "place-tracks-hit",
  "standalone-tracks-hit",
];

/** The gauge a press lands on, or null when a pin, route or track is there
 *  too: each layer's click handler fires on its own, so this picks the winner. */
export function pressedGaugeId(
  map: {
    getLayer(id: string): unknown;
    queryRenderedFeatures(
      point: [number, number],
      options: { layers: string[] },
    ): { properties?: Record<string, unknown> | null }[];
  },
  point: [number, number],
): string | null {
  const over = PRESSABLE_LAYERS.filter((id) => map.getLayer(id));
  if (over.length && map.queryRenderedFeatures(point, { layers: over }).length)
    return null;
  const id = map.queryRenderedFeatures(point, { layers: [GAUGE_LAYER] })[0]
    ?.properties?.id;
  return typeof id === "string" ? id : null;
}
/** How long after its panel closes a press on the gauge still counts as the
 *  press that closed it. */
export const GAUGE_RETAP_MS = 500;

/** Whether a press on gauge `id` is the one that just closed its panel. The
 *  panel closes on pointerdown and the map's click comes after, so without
 *  this the same press would open it again. */
export function pressClosedGauge(
  id: string,
  closed: { id: string; at: number } | null,
  now: number,
): boolean {
  return closed?.id === id && now - closed.at < GAUGE_RETAP_MS;
}

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
