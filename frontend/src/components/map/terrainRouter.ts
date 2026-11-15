// The Terrain group's tiles once the user can see a sharpened area: each tile
// from exactly one archive, the statewide one or one area's
// (`terrainTileArchive` in shared/src/sharpen.ts, ADR 0040), so no pixel is
// drawn by two and the hillshade's border fill reads real heights across an
// area's edge.
//
// A tile the router leaves absent is a thrown `AbsentTerrainTile`: MapLibre
// marks it errored and draws the loaded parent, as ordinary overzoom. A null
// `data` draws an empty tile instead, not the parent (MapLibre GL JS 6.14,
// checked on the dev stack; `terrainRouter.test.ts` holds the throw).
//
// PRIVACY: a tile index is a coarse location, and an area's URL is a bearer
// credential. Nothing here logs either (`terrainRouter.test.ts`, "logs
// nothing").
import {
  areasInRegion,
  layerIn,
  REGIONS,
  type Region,
  SHARPENED_ARCHIVE_URL,
  sharpenedDemSource,
  terrainTileArchive,
  type SharpenedOverlay,
  type TerrainArchiveLayer,
  type OverlayTerrainKey,
  type TerrainLayerKey,
  WORLD,
} from "@logjam/shared";
import { PMTiles } from "pmtiles";

export const TERRAIN_PROTOCOL = "logjam-terrain";

/** An overlay is no surface a sharpened area replaces: its archive is read as it is. */
export type RoutedTerrainKey = Exclude<TerrainLayerKey, OverlayTerrainKey>;

/** Which of an area's archives a layer reads: the hillshade shades heights. */
const ARCHIVE_LAYER: Record<RoutedTerrainKey, TerrainArchiveLayer> = {
  contours: "contours",
  slope: "slope",
  hillshade: "heights",
};

/** Whether a sharpened area replaces a layer's surface: the others are read as they are. */
export const isRouted = (key: TerrainLayerKey): key is RoutedTerrainKey =>
  key in ARCHIVE_LAYER;

let routedAreas: readonly SharpenedOverlay[] = [];
let routedRegions: readonly Region[] = [];

/**
 * The areas the router reads: the ones the user can see, with fresh URLs. A
 * tile is answered for the `regions` it knows (every declared region by
 * default), and from the areas each holds; one asked for under any other id is
 * absent.
 */
export function setRoutedAreas(
  areas: readonly SharpenedOverlay[],
  regions: readonly Region[] = [...REGIONS, WORLD],
): void {
  routedAreas = areas;
  routedRegions = regions;
}

const ABSENT = "absent terrain tile";

/** A tile no archive holds at this zoom: its parent is drawn instead. */
export class AbsentTerrainTile extends Error {
  constructor() {
    super(ABSENT);
    this.name = "AbsentTerrainTile";
  }
}

/** By message: the error can reach the map's handler as a copy. */
export function isAbsentTerrainTile(error: unknown): boolean {
  return (error as { message?: unknown } | null)?.message === ABSENT;
}

const archives = new Map<string, PMTiles>();
function archiveAt(url: string): PMTiles {
  let archive = archives.get(url);
  if (!archive) archives.set(url, (archive = new PMTiles(url)));
  return archive;
}

/**
 * A short key for the set of areas: in each routed tile URL, so a change of
 * set gives the map new sources (a new zmax, and no tile cached from the old
 * set). Fresh presigned URLs keep the key: the router reads them as they are.
 */
export function areasKey(areas: readonly SharpenedOverlay[]): string {
  const text = areas
    .map((a) => `${a.id}:${a.zmax}:${a.contours ? 1 : 0}`)
    .sort()
    .join(",");
  let hash = 5381;
  for (let i = 0; i < text.length; i++)
    hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

/** The routed URL template for one Terrain layer of `region`. */
export function terrainTileTemplate(
  region: Region,
  key: RoutedTerrainKey,
  areas: readonly SharpenedOverlay[],
): string {
  return `${TERRAIN_PROTOCOL}://${region.id}/${key}/${areasKey(areas)}/{z}/{x}/{y}`;
}

/**
 * The credit for a routed layer: the region's own, then every visible area's,
 * each line once (areas from the same month credit alike).
 */
export function routedAttribution(
  statewide: string,
  areas: readonly SharpenedOverlay[],
): string {
  const lines = areas.map((area) => sharpenedDemSource(area).creditHtml);
  return [statewide, ...new Set(lines)].join(" ");
}

const URL_PATTERN = new RegExp(
  `^${TERRAIN_PROTOCOL}://([a-z0-9]+)/(contours|slope|hillshade)/[^/]*/(\\d+)/(\\d+)/(\\d+)$`,
);

/** MapLibre's protocol handler for `logjam-terrain://`. */
export async function terrainTile(
  params: { url: string },
  abort: AbortController,
): Promise<{ data: Uint8Array }> {
  const match = URL_PATTERN.exec(params.url);
  if (!match) throw new Error("Not a terrain tile URL");
  const key = match[2] as RoutedTerrainKey;
  const layer = ARCHIVE_LAYER[key];
  const [z, x, y] = [match[3], match[4], match[5]].map(Number) as [
    number,
    number,
    number,
  ];
  const region = routedRegions.find(({ id }) => id === match[1]) ?? null;
  const archive = layerIn(region, key);
  if (!archive) throw new AbsentTerrainTile();
  const answer = terrainTileArchive(
    areasInRegion(region, routedAreas),
    layer,
    z,
    x,
    y,
  );
  if (answer === "absent") throw new AbsentTerrainTile();
  const statewide = answer === "statewide";
  const url = statewide
    ? `${window.location.origin}/${archive.archivePath}`
    : answer[SHARPENED_ARCHIVE_URL[layer]];
  // The router hands contours only to an area that has them.
  if (!url) throw new AbsentTerrainTile();
  let tile;
  try {
    tile = await archiveAt(url).getZxy(z, x, y, abort.signal);
  } catch (error) {
    // An area's URL can expire, or its job be deleted, while the map holds
    // it. Its tile is then absent, so the parent draws: thrown on, the
    // failure would read as the shared statewide source being gone, and the
    // map would drop the whole layer. An abort is MapLibre's own, and the
    // statewide archive's failures are the source's.
    if (statewide || (error as { name?: unknown })?.name === "AbortError")
      throw error;
    throw new AbsentTerrainTile();
  }
  if (tile) return { data: new Uint8Array(tile.data) };
  // A vector tile with nothing in it is empty, as the pmtiles protocol has
  // it; a raster one is left to its parent.
  if (layer === "contours") return { data: new Uint8Array() };
  throw new AbsentTerrainTile();
}
