// Where the map tools get their snapping geometry.
//
// Reads the Protomaps PMTiles archive directly (shared/src/snapTiles.ts), NOT
// the rendered map. Asking the map what it had drawn tied snapping to the
// active basemap and to being zoomed in far enough, and truncated any way that
// continued off-screen — which is what made it refuse, and take silly routes,
// depending on where you happened to be looking.
//
// OFFLINE: this is an HTTP range request, so with no signal it fails and the
// tools fall back to the straight line they would have drawn anyway. The
// downloaded basemap regions are PMTiles files in app-private storage, so
// pointing the same reader at a local file is the way to make snapping work
// offline — inside saved regions only, which is the same boundary the offline
// basemap already draws.
//
// PRIVACY: the bbox comes from where the user is drawing. It selects tiles to
// range-request from our own CDN and is never sent as a query. Nothing logs.
import { BASEMAP_CATALOG, fetchSnapLines, type SnapLine, type SnapMode } from "@logjam/shared";

import { config } from "../config";

/**
 * The archive to read. Same host the vector basemap itself streams from, so
 * snapping needs no new network permission or endpoint.
 */
function archiveUrl(): string {
  const entry = BASEMAP_CATALOG.find((e) => e.id === "protomaps");
  // Fail loudly — a missing catalog entry is a programming error.
  if (!entry) throw new Error("protomaps missing from BASEMAP_CATALOG");
  return `${config.topoCdnBaseUrl}/${entry.urlTemplate}`;
}

/**
 * Candidate ways for the segment between two points. Empty when snapping is
 * off, or when the archive can't be reached — both normal outcomes the caller
 * renders as a straight line.
 */
export function collectSnapLines(
  mode: SnapMode,
  from: [number, number],
  to: [number, number],
): Promise<SnapLine[]> {
  return fetchSnapLines(archiveUrl(), mode, from, to);
}
