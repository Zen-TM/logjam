// Pure decisions the tile-pyramid downloader makes, kept apart from the engine
// so they can be tested without a React Native runtime: the order tiles are
// fetched in (which resume depends on), the identity of a checkpoint's premise,
// the provider URL shape, and what a given HTTP response actually means.
//
// The response classifier is the one worth reading twice — it is what stops a
// 200 carrying an error page being written into the archive as a tile.
import { REGION_MIN_ZOOM, type RegionBbox, type RegionTilePlan } from "@logjam/shared";

import { hashKey } from "../map/sourceResolver";

/** Plan order: zoom ascending, then row-major within a level (stage4a §4.4). */
export function regionTileSequence(plan: RegionTilePlan): [number, number, number][] {
  const tiles: [number, number, number][] = [];
  for (const level of plan.perZoom) {
    for (let y = level.y0; y <= level.y1; y++) {
      for (let x = level.x0; x <= level.x1; x++) tiles.push([level.z, x, y]);
    }
  }
  return tiles;
}

/**
 * Identity of the premise a checkpoint was built against. A resumed file whose
 * hash disagrees was planned for a different area or depth, so its gap list is
 * meaningless (the tiles themselves stay valid — inserts are idempotent).
 */
export function regionPlanHash(spec: {
  basemapId: string;
  bbox: RegionBbox;
  zMax: number;
}): string {
  const { west, south, east, north } = spec.bbox;
  return hashKey(
    `${spec.basemapId}|${west.toFixed(6)},${south.toFixed(6)},${east.toFixed(6)},${north.toFixed(6)}|${REGION_MIN_ZOOM}-${spec.zMax}|1`,
  );
}

/**
 * SIX serves ArcGIS-style `/tile/{z}/{row}/{col}`, and its cache has a top-left
 * origin, so `{row}` IS the XYZ y — no flip here. The TMS flip happens on the
 * way INTO MBTiles; flipping in both places renders a mirrored map.
 */
export function tileUrlFrom(
  urlTemplate: string,
  z: number,
  x: number,
  y: number,
): string {
  return urlTemplate
    .replace("{z}", String(z))
    .replace("{y}", String(y))
    .replace("{x}", String(x));
}

export type TileVerdict = "ok" | "gap" | "backoff" | "retry";

/**
 * What a tile response means.
 *
 * - 404 is a GAP: the provider never cached that tile (measured: six-imagery
 *   answers 404 for a third of z18 bush tiles). Not a failure, never retried.
 * - 403/429 is the provider pushing back ⇒ stop the whole job.
 * - Anything else non-200, or a 200 that isn't a non-empty image, is retryable.
 */
export function classifyTileResponse(
  status: number,
  contentType: string | null,
  byteLength: number,
): TileVerdict {
  if (status === 404) return "gap";
  if (status === 403 || status === 429) return "backoff";
  if (status !== 200) return "retry";
  if (!contentType || !contentType.startsWith("image/")) return "retry";
  if (byteLength <= 0) return "retry";
  return "ok";
}

/**
 * How many dead tiles make a region a failure rather than an imperfect map. A
 * few holes still leave a usable map; a systematic problem does not, and
 * shipping it as "ready" would hand the user a map with silent voids in it.
 */
export function deadTileBudget(totalTiles: number): number {
  return Math.max(10, Math.floor(totalTiles * 0.01));
}
