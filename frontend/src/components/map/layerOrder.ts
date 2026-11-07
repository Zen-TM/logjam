// Where the topo band sits in Logjam Web's style: over the basemap, under
// every track, route and place pin, as on Logjam GPS
// (mobile/src/map/layerOrder.ts). The statewide slope and hillshade cover
// whole areas, and over a route they would tint and shade it. Over the vector
// basemap the Terrain group goes inside the basemap instead, under its roads
// and labels (shared TERRAIN_BASEMAP_ANCHORS).
import {
  type CarrierId,
  coverageNameOf,
  fireNameOf,
  landNameOf,
  terrainBeforeIds,
  type TerrainLayerKey,
} from "@logjam/shared";

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

/**
 * The MGA grid sits at the gauges' height, over the topo band and under every
 * pin, as on Logjam GPS. Guard: `layerOrder.test.ts`.
 */
export const GRID_LINES = "mga-grid-lines";
export const GRID_LABELS = "mga-grid-labels";

/** Everything else on the map with a press of its own. A gauge drop under one
 *  of these is not the thing pressed. */
export const PRESSABLE_LAYERS = [
  "place-circles",
  "visited-place-badges",
  "shared-place-badges",
  "shared-place-circles",
  "routes-hit",
  "place-tracks-hit",
  "standalone-tracks-hit",
];

/** The Land overlay's fill, by the id `topo-<entry id>-<suffix>` every topo layer has. */
export const LAND_FILL_LAYER = "topo-nswland-fill";
export const LAND_EDGE_LAYER = "topo-nswland-edge";
/** The Fire history overlay's tint and its edge, named the same way. */
export const FIRE_FILL_LAYER = "topo-nswfire-fill";
export const FIRE_EDGE_LAYER = "topo-nswfire-edge";
/** The Coverage overlay's hatch, the same way. */
export const COVERAGE_FILL_LAYER = "topo-nswcoverage-fill";
/** The Weather overlay's colour field and its wind arrows, the same way. */
export const WEATHER_FIELD_LAYER = "topo-nswweather-dem";
export const WEATHER_ARROWS_LAYER = "topo-nswweather-arrows";

type RenderedQuery = {
  getLayer(id: string): unknown;
  queryRenderedFeatures(
    point: [number, number],
    options: { layers: string[] },
  ): { properties?: Record<string, unknown> | null }[];
};

/**
 * The name of the land class drawn at `point`, or null: the overlay is off, or
 * no class is drawn there. Read from the tiles on screen, so "What is here?"
 * sends no coordinate anywhere to answer.
 */
export function landClassAt(
  map: RenderedQuery,
  point: [number, number],
): string | null {
  if (!map.getLayer(LAND_FILL_LAYER)) return null;
  return landNameOf(
    map.queryRenderedFeatures(point, { layers: [LAND_FILL_LAYER] }),
  );
}

/**
 * The most recent fire drawn at `point` ("Wildfire, Dec 2019"), or null: the
 * overlay is off, or nothing burnt there. The fill is queried even at opacity
 * 0, so a fire over ten years old still answers.
 */
export function fireAt(
  map: RenderedQuery,
  point: [number, number],
): string | null {
  if (!map.getLayer(FIRE_FILL_LAYER)) return null;
  return fireNameOf(
    map.queryRenderedFeatures(point, { layers: [FIRE_FILL_LAYER] }),
  );
}

/**
 * What the Coverage overlay predicts at `point` for `carrier` ("Telstra:
 * external antenna only"), or null: the overlay is off, or the point is off
 * the land it covers. Where a handset works the fill is clear, and still
 * answers.
 */
export function coverageAt(
  map: RenderedQuery,
  point: [number, number],
  carrier: CarrierId,
): string | null {
  if (!map.getLayer(COVERAGE_FILL_LAYER)) return null;
  return coverageNameOf(
    map.queryRenderedFeatures(point, { layers: [COVERAGE_FILL_LAYER] }),
    carrier,
  );
}

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
