// The Terrain group's tiles once the user can see a sharpened area: each tile
// from exactly one archive, the statewide one or one area's
// (`terrainTileArchive` in shared/src/sharpen.ts, ADR 0040), so no pixel is
// drawn by two and the hillshade's border fill reads real heights across an
// area's edge.
//
// A tile the router leaves absent is a thrown `AbsentTerrainTile`: MapLibre
// then draws the loaded parent tile, as ordinary overzoom. A null `data`
// would leave the tile loading for good, with no parent and no `idle`
// (checked on GL JS 5.24; `terrainRouter.test.ts` holds the throw).
//
// PRIVACY: a tile index is a coarse location, and an area's URL is a bearer
// credential. Nothing here logs either.
import {
  NSW_5M,
  NSW_CONTOURS,
  NSW_SLOPE,
  escapeXml,
  terrainTileArchive,
  type SharpenedOverlay,
  type TerrainArchiveLayer,
  type TerrainLayerKey,
} from "@logjam/shared";
import { PMTiles } from "pmtiles";

export const TERRAIN_PROTOCOL = "logjam-terrain";

/** The archive each Terrain layer reads: the hillshade shades the heights. */
const ARCHIVE_LAYER: Record<TerrainLayerKey, TerrainArchiveLayer> = {
  contours: "contours",
  slope: "slope",
  hillshade: "heights",
};

const STATEWIDE_PATH: Record<TerrainArchiveLayer, string> = {
  heights: NSW_5M.archivePath,
  slope: NSW_SLOPE.archivePath,
  contours: NSW_CONTOURS.archivePath,
};

const AREA_URL = {
  heights: "heightsUrl",
  slope: "slopeUrl",
  contours: "contoursUrl",
} as const satisfies Record<TerrainArchiveLayer, keyof SharpenedOverlay>;

let routedAreas: readonly SharpenedOverlay[] = [];

/** The areas the router reads: the ones the user can see, with fresh URLs. */
export function setRoutedAreas(areas: readonly SharpenedOverlay[]): void {
  routedAreas = areas;
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

/** The routed URL template for one Terrain layer. */
export function terrainTileTemplate(
  key: TerrainLayerKey,
  areas: readonly SharpenedOverlay[],
): string {
  return `${TERRAIN_PROTOCOL}://${key}/${areasKey(areas)}/{z}/{x}/{y}`;
}

/** The credit for a routed layer: the statewide one, then each area's. */
export function routedAttribution(
  statewide: string,
  areas: readonly SharpenedOverlay[],
): string {
  return [statewide, ...areas.map((a) => escapeXml(a.credit))].join(" ");
}

const URL_PATTERN = new RegExp(
  `^${TERRAIN_PROTOCOL}://(contours|slope|hillshade)/[^/]*/(\\d+)/(\\d+)/(\\d+)$`,
);

/** MapLibre's protocol handler for `logjam-terrain://`. */
export async function terrainTile(
  params: { url: string },
  abort: AbortController,
): Promise<{ data: Uint8Array }> {
  const match = URL_PATTERN.exec(params.url);
  if (!match) throw new Error("Not a terrain tile URL");
  const layer = ARCHIVE_LAYER[match[1] as TerrainLayerKey];
  const [z, x, y] = [match[2], match[3], match[4]].map(Number) as [
    number,
    number,
    number,
  ];
  const answer = terrainTileArchive(routedAreas, layer, z, x, y);
  if (answer === "absent") throw new AbsentTerrainTile();
  const url =
    answer === "statewide"
      ? `${window.location.origin}/${STATEWIDE_PATH[layer]}`
      : answer[AREA_URL[layer]];
  // The router hands contours only to an area that has them.
  if (!url) throw new AbsentTerrainTile();
  const tile = await archiveAt(url).getZxy(z, x, y, abort.signal);
  if (tile) return { data: new Uint8Array(tile.data) };
  // A vector tile with nothing in it is empty, as the pmtiles protocol has
  // it; a raster one is left to its parent.
  if (layer === "contours") return { data: new Uint8Array() };
  throw new AbsentTerrainTile();
}
