// Pure decisions the tile-pyramid downloader makes, kept apart from the engine
// so they can be tested without a React Native runtime: the order tiles are
// fetched in (which resume depends on), the identity of a checkpoint's premise,
// the provider URL shape, and what a given HTTP response actually means.
//
// The response classifier is the one worth reading twice — it is what stops a
// 200 carrying an error page being written into the archive as a tile.
import { type RegionBbox, type RegionTilePlan } from "@logjam/shared";

import { hashKey } from "../map/sourceResolver";

/** Plan order: zoom ascending, then row-major within a level. */
export function regionTileSequence(
  plan: RegionTilePlan,
): [number, number, number][] {
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
  /** Shallowest planned level — part of the premise since the DEM's pyramid
   * starts at its own zoom rather than REGION_MIN_ZOOM. Hashing only zMax would
   * make two genuinely different plans compare equal. */
  zMin: number;
  zMax: number;
}): string {
  const { west, south, east, north } = spec.bbox;
  return hashKey(
    `${spec.basemapId}|${west.toFixed(6)},${south.toFixed(6)},${east.toFixed(6)},${north.toFixed(6)}|${spec.zMin}-${spec.zMax}|1`,
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

/**
 * Does the vector map come with this area?
 *
 * It rides along with every region a signed-in user saves, as the DEM does:
 * it is a few megabytes, and without it the Vector map is blank out there and
 * the route and measure tools stop snapping to tracks. A guest cannot have it
 * (the clip is cut by an authed API call). No area is larger than the clip
 * endpoint cuts: `checkRegionCaps` refuses it for everyone.
 * Guard: `regionTilePlanning.test.ts` ("vectorClipFor").
 */
export function vectorClipFor(isGuest: boolean): "include" | "none" {
  return isGuest ? "none" : "include";
}

/**
 * Is the vector map the whole save? The Detail caption then says so instead of
 * quoting a pixel scale no raster will have. Never true without the clip: a
 * guest with no map picked is saving nothing, not the detailed map.
 * Guard: `regionTilePlanning.test.ts` ("savesVectorOnly").
 */
export function savesVectorOnly(
  vectorClip: "include" | "none",
  pyramids: number,
): boolean {
  return vectorClip === "include" && pyramids === 0;
}

/**
 * How a run ended, given what the user asked of it and what its workers
 * halted on.
 *
 * The workers share one halt slot and only look at the user's request between
 * tiles, so a worker midway through a tile's retries can halt the job for its
 * own reason after another has already honoured a cancel or a pause. What the
 * user asked for wins: a cancelled job that ended "paused for a connection"
 * kept its file and restarted itself on the next reconnect.
 * Guard: `regionTilePlanning.test.ts` ("settledStop").
 */
export function settledStop<Halt extends { kind: string }>(
  asked: null | "pause" | "cancel",
  halted: Halt | null,
): Halt | { kind: "cancelled" } | { kind: "paused"; reason: "user" } | null {
  if (asked === "cancel") return { kind: "cancelled" };
  if (asked === "pause" && halted?.kind === "paused") {
    return { kind: "paused", reason: "user" };
  }
  return halted;
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

/**
 * What a tile that has used up its retries means.
 *
 * A download keeps running when the app leaves the foreground, for as long as
 * Android lets the process run. The one thing that can go wrong back there is
 * the OS withholding the network from a process that is still alive, and that
 * is not the provider failing: the job parks (the queue re-queues it on the
 * next foreground edge) instead of spending its dead-tile budget on it.
 * With no connection at all it is neither: the job waits for the connection,
 * which the queue bounds behind another app (`mayResumeOnReconnect`).
 * Guard: `regionTilePlanning.test.ts` ("exhaustedTileOutcome").
 */
export function exhaustedTileOutcome(
  appState: string | null | undefined,
  online: boolean,
): "dead" | "park" | "offline" {
  if (!online) return "offline";
  return appState === "active" ? "dead" : "park";
}
