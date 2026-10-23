// The statewide Terrain group: contours, slope and hillshade over all of NSW,
// from the 5 m DEM, with no LiDAR job. Each client only draws these.
//
// Slope is baked once as a fake DEM: a terrarium archive whose "height" is the
// slope in degrees (ADR 0030 encoding), built by `topo/build_nsw_dem.py slope`.
// A client loads it as a `raster-dem` source and colours it with a
// `color-relief` layer, so the bands are a paint expression: the user's own,
// with no rebuild. Hillshade is MapLibre's own `hillshade` layer on the height
// archive, so it needs no pipeline at all.
import { NSW_5M } from "./demSources.js";
import { rgbaCssFromHex, type SlopeBand } from "./topoSettings.js";

export const NSW_SLOPE = {
  /** A saved clip is filed under this, beside the area it was saved with. */
  id: "nsw-5m-slope",
  /** Beside the height archive it is derived from. */
  archivePath: "master/dem/nsw-5m-slope.pmtiles",
  // z15 is Horn over the z15 height tiles (equal to `demSlopeAt`); each
  // coarser zoom is the max of the one below, so a cliff never fades out of
  // its band as the map zooms out.
  minzoom: 8,
  maxzoom: 15,
  coverage: NSW_5M.coverage,
  credit: NSW_5M.credit.replace(/^Elevation/, "Slope"),
  creditHtml: NSW_5M.creditHtml.replace(/^Elevation/, "Slope"),
} as const;

/** Drawn from the height archive itself, at the zooms it was built at. */
export const NSW_HILLSHADE = {
  id: "nsw-5m-hillshade",
  archivePath: NSW_5M.archivePath,
  minzoom: 8,
  maxzoom: NSW_5M.sampleZoom,
  coverage: NSW_5M.coverage,
  credit: NSW_5M.credit.replace(/^Elevation/, "Hillshade"),
  creditHtml: NSW_5M.creditHtml.replace(/^Elevation/, "Hillshade"),
} as const;

/**
 * The group's layers, top of the map first: contour lines over the slope
 * colours over the shading. Both clients list them in this order and stack
 * them in it.
 */
export const TERRAIN_LAYER_KEYS = ["contours", "slope", "hillshade"] as const;

export type TerrainLayerKey = (typeof TERRAIN_LAYER_KEYS)[number];

/**
 * Where each Terrain layer goes in the vector basemap, as a printed topo map
 * has it: directly under this layer of the Protomaps style (its
 * `@protomaps/basemaps` id, before a client's prefix). The shading lies over
 * the land fills and under the water; the slope and then the contours lie over
 * the water's fill and under its lines, the roads, the boundaries and every
 * label. Over a raster basemap there is nothing to interleave, and the group
 * sits on top of it. Guards: `terrain.test.ts`, and each client's test that
 * the ids are in the style it draws (frontend `components/map/layerOrder.test.ts`,
 * mobile `map/basemap/protomapsLayers.test.ts`).
 */
export const TERRAIN_BASEMAP_ANCHORS: Readonly<
  Record<TerrainLayerKey, string>
> = {
  contours: "water_stream",
  slope: "water_stream",
  hillshade: "water",
};

/**
 * The Protomaps layers that must draw over the whole Terrain group: every
 * label, boundary and road, but the runway and taxiway surfaces, drawn with
 * the land fills. Guards: the clients' anchor tests above, each against the
 * style it draws.
 */
export function drawsOverTerrain(layer: { id: string; type: string }): boolean {
  if (layer.id === "roads_runway" || layer.id === "roads_taxiway") return false;
  return (
    layer.type === "symbol" ||
    layer.id.startsWith("boundaries") ||
    layer.id.startsWith("roads_")
  );
}

/**
 * Each Terrain layer's `beforeId` inside the vector basemap, top of the map
 * first, so moving the layers in this order lands each under one already in
 * place. `layerIds` lists each key's map layers bottom first; `anchorId` turns
 * a Protomaps id into the client's. Layers sharing an anchor stack in
 * `TERRAIN_LAYER_KEYS` order, so the slope is always directly under the
 * contours.
 */
export function terrainBeforeIds(
  layerIds: Readonly<Record<TerrainLayerKey, readonly string[]>>,
  anchorId: (protomapsLayerId: string) => string,
): [layerId: string, beforeId: string][] {
  const pairs: [string, string][] = [];
  const lowest = new Map<string, string>();
  for (const key of TERRAIN_LAYER_KEYS) {
    const anchor = TERRAIN_BASEMAP_ANCHORS[key];
    let before = lowest.get(anchor) ?? anchorId(anchor);
    for (const id of [...layerIds[key]].reverse()) {
      pairs.push([id, before]);
      before = id;
    }
    lowest.set(anchor, before);
  }
  return pairs;
}

/** What a map shows before the user touches a switch: the contours it always had. */
export const TERRAIN_LAYER_DEFAULTS: Readonly<
  Record<TerrainLayerKey, boolean>
> = { contours: true, slope: false, hillshade: false };

/**
 * The switches as stored on a device, with anything missing or not a boolean
 * read as its default: an older build's value, or none at all.
 */
export function normalizeTerrainLayers(
  value: unknown,
): Record<TerrainLayerKey, boolean> {
  const stored =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    TERRAIN_LAYER_KEYS.map((key) => [
      key,
      typeof stored[key] === "boolean"
        ? stored[key]
        : TERRAIN_LAYER_DEFAULTS[key],
    ]),
  ) as Record<TerrainLayerKey, boolean>;
}

const CLEAR = "rgba(0,0,0,0)";
/** How far below an edge its doubled stop sits: well under the archive's 1° step. */
const EDGE = 0.001;

/**
 * The `color-relief-color` expression that paints `bands` (contiguous and
 * ascending, as `slopeBandsError` requires) with hard edges.
 *
 * `color-relief` interpolates between stops, so each edge is two stops a hair
 * apart: the colour below it, then the colour above. Everything under the
 * first band and over the last is clear, and so is no-data, which the
 * terrarium encoding decodes to −32768 and the first stop clamps.
 * Guard: `terrain.test.ts`.
 */
export function slopeReliefColor(bands: readonly SlopeBand[]): unknown[] {
  const stops: (string | number)[] = [];
  let below = CLEAR;
  for (const band of bands) {
    const colour = rgbaCssFromHex(band.colour);
    stops.push(band.fromDeg - EDGE, below, band.fromDeg, colour);
    below = colour;
  }
  const top = bands[bands.length - 1]?.toDeg ?? 90;
  if (top < 90) stops.push(top - EDGE, below, top, CLEAR);
  return ["interpolate", ["linear"], ["elevation"], ...stops];
}
