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
  layerIn,
  type Region,
  TERRAIN_LAYER_KEYS,
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

/**
 * The topo entry id of a region's Terrain layer: the region's id, then the
 * layer's key, with no dash, because `Map.tsx` splits a topo layer's id
 * `topo-<entry id>-<suffix>` at its first dash. Guard: `terrainEntries.test.ts`
 * ("names each entry so its layer is read back from the id").
 */
export function terrainEntryId(region: Region, key: TerrainLayerKey): string {
  return `${region.id}${key}`;
}

const ENTRY_ID = new RegExp(`^[a-z0-9]+(${TERRAIN_LAYER_KEYS.join("|")})$`);

/** The layer a topo entry id is a region's Terrain layer for, or null: any other entry. */
export function terrainKeyOf(entryId: string): TerrainLayerKey | null {
  return (ENTRY_ID.exec(entryId)?.[1] as TerrainLayerKey | undefined) ?? null;
}

/**
 * The Land overlay's fill and edge lines of `region`, by the id
 * `topo-<entry id>-<suffix>` every topo layer has. The edge lines add
 * `-<index>`.
 */
export const landFillLayer = (region: Region): string =>
  `topo-${terrainEntryId(region, "land")}-fill`;
export const landEdgeLayer = (region: Region): string =>
  `topo-${terrainEntryId(region, "land")}-edge`;
/** The Fire history overlay's tint and its edge, named the same way. */
export const fireFillLayer = (region: Region): string =>
  `topo-${terrainEntryId(region, "fire")}-fill`;
export const fireEdgeLayer = (region: Region): string =>
  `topo-${terrainEntryId(region, "fire")}-edge`;
/** The Coverage overlay's hatch, the same way. */
export const coverageFillLayer = (region: Region): string =>
  `topo-${terrainEntryId(region, "coverage")}-fill`;

type RenderedQuery = {
  getLayer(id: string): unknown;
  queryRenderedFeatures(
    point: [number, number],
    options: { layers: string[] },
  ): {
    properties?: Record<string, unknown> | null;
    geometry?: { type: string; coordinates?: unknown } | null;
  }[];
};

/**
 * The name of the land class drawn at `point`, or null: the overlay is off, or
 * no class is drawn there. Read from the tiles on screen, so "What is here?"
 * sends no coordinate anywhere to answer.
 */
export function landClassAt(
  map: RenderedQuery,
  point: [number, number],
  region: Region | null,
): string | null {
  const land = layerIn(region, "land");
  if (!region || !land || !map.getLayer(landFillLayer(region))) return null;
  return landNameOf(
    land,
    map.queryRenderedFeatures(point, { layers: [landFillLayer(region)] }),
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
  region: Region | null,
): string | null {
  const fire = layerIn(region, "fire");
  if (!region || !fire || !map.getLayer(fireFillLayer(region))) return null;
  return fireNameOf(
    fire,
    map.queryRenderedFeatures(point, { layers: [fireFillLayer(region)] }),
  );
}

/**
 * What the Coverage overlay predicts at `point` (pixels; `at` is the same
 * spot as [lng, lat]) for `carrier` ("Telstra: no mobile reception"), or
 * null: the overlay is off, or the point is off the land it covers. Where
 * there is reception the fill is clear, and still answers.
 */
export function coverageAt(
  map: RenderedQuery,
  point: [number, number],
  at: readonly [number, number],
  carrier: CarrierId,
  region: Region | null,
): string | null {
  const coverage = layerIn(region, "coverage");
  if (!region || !coverage || !map.getLayer(coverageFillLayer(region)))
    return null;
  return coverageNameOf(
    coverage,
    map.queryRenderedFeatures(point, { layers: [coverageFillLayer(region)] }),
    carrier,
    at,
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
