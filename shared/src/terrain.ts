// The statewide Terrain group: contours, slope and hillshade over all of NSW,
// from the 5 m DEM, with no LiDAR job, and Land (nswLand.ts), from the land
// tenure layer. Each client only draws these.
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
 * colours over the tint of who holds the land over the shading. Both clients
 * list them in this order and stack them in it.
 */
export const TERRAIN_LAYER_KEYS = [
  "contours",
  "slope",
  "land",
  "hillshade",
] as const;

export type TerrainLayerKey = (typeof TERRAIN_LAYER_KEYS)[number];

/**
 * Where each Terrain layer goes in the vector basemap, as a printed topo map
 * has it: directly under this layer of the Protomaps style (its
 * `@protomaps/basemaps` id, before a client's prefix). The shading lies over
 * the land fills and under the water, with Land's tint on it, so a lake stays a
 * lake; the slope and then the contours lie over the water's fill and under its lines, the roads, the boundaries and every
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
  land: "water",
  hillshade: "water",
};

/**
 * The Protomaps layers that must draw over the whole Terrain group: every
 * label, boundary and road, but the runway and taxiway surfaces, drawn with
 * the land fills. Guards: `terrain.test.ts` ("drawsOverTerrain"), and the
 * clients' anchor tests above, each against the style it draws.
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

/**
 * Every stored Terrain switch: the layers above, Land tenure among them though
 * its row is listed under Overlays, and the sharpened areas' optional vegetation
 * layer, which is drawn from their own archives rather than stacked into the
 * basemap, so it is not a `TerrainLayerKey`.
 */
export const TERRAIN_SWITCH_KEYS = [
  ...TERRAIN_LAYER_KEYS,
  "vegetation",
] as const;

export type TerrainSwitchKey = (typeof TERRAIN_SWITCH_KEYS)[number];

/**
 * What a map shows before the user touches a switch: contours and slope, and
 * any vegetation layer, which the owner asked for when they made the area.
 */
export const TERRAIN_LAYER_DEFAULTS: Readonly<
  Record<TerrainSwitchKey, boolean>
> = {
  contours: true,
  slope: true,
  land: false,
  hillshade: false,
  vegetation: true,
};

/**
 * The switches as stored on a device, with anything missing or not a boolean
 * read as its default: an older build's value, or none at all.
 */
export function normalizeTerrainLayers(
  value: unknown,
): Record<TerrainSwitchKey, boolean> {
  const stored =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    TERRAIN_SWITCH_KEYS.map((key) => [
      key,
      typeof stored[key] === "boolean"
        ? stored[key]
        : TERRAIN_LAYER_DEFAULTS[key],
    ]),
  ) as Record<TerrainSwitchKey, boolean>;
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

/**
 * The band a slope falls in, or null where `slopeReliefColor` paints clear:
 * no-data (it decodes to −32768), under the first band, or over a top band
 * short of 90°. The same rule for a renderer with no MapLibre, the GeoPDF.
 * Guard: `terrain.test.ts`, against the expression itself.
 */
export function slopeBandAt(
  bands: readonly SlopeBand[],
  degrees: number,
): SlopeBand | null {
  const last = bands[bands.length - 1];
  return (
    bands.find(
      (band) =>
        degrees >= band.fromDeg &&
        (degrees < band.toDeg || (band === last && band.toDeg >= 90)),
    ) ?? null
  );
}

/**
 * One credit for the statewide layers a printed map drew, top of the map
 * first ("Contours, slope and hillshade: derived from the NSW 5 m …"): each
 * layer's own credit has the same body, and a sheet has room for one line.
 * A sharpened area's `credit` reads the same way, in place of the 5 m one.
 */
export function terrainCredit(
  drawn: Iterable<TerrainLayerKey>,
  credit: string = NSW_5M.credit,
): string | null {
  const keys = new Set(drawn);
  const names = TERRAIN_LAYER_KEYS.filter(
    // Land has a credit of its own: `GEOPDF_OVERLAY_ATTRIBUTION`.
    (key) => key !== "land" && keys.has(key),
  );
  if (names.length === 0) return null;
  const list =
    names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return credit.replace(/^Elevation/, list[0]!.toUpperCase() + list.slice(1));
}
