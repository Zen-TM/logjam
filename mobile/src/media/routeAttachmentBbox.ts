import * as FileSystem from "expo-file-system/legacy";
import { parseVectorImport } from "@logjam/shared";

import { ensureDisplayCached } from "../sync/mediaCache";

/**
 * Resolves a route attachment's (.gpx/.kml) map extent, so "show me where this
 * trip went" can fly the camera there without drawing anything — the file is
 * never rendered (deleted 2026-08-22, mobile UX batch item 4: it drew a
 * transient line plus a dismissable filename badge over the map, which was
 * unwanted). This is the one part of that path worth keeping: parsing is what
 * finds the extent.
 *
 * Throws rather than returning null — an uncached attachment is a real,
 * expected case, and the caller must surface it (its own toast channel), not
 * swallow it.
 *
 * PRIVACY: the parsed geometry never leaves this function; only the bbox it
 * returns is used.
 */
export async function resolveRouteAttachmentBbox(request: {
  mediaId: string;
  filename: string;
  /**
   * The on-device copy, when there is one. An attachment that hasn't uploaded
   * yet exists ONLY locally — asking the cache to fetch it would fail, and
   * "look at the route I just recorded" is exactly the case that must work.
   */
  localPath?: string | null;
}): Promise<[number, number, number, number]> {
  const uri = request.localPath ?? (await ensureDisplayCached(request.mediaId));
  if (uri === null) throw new Error("route file not cached");
  const text = await FileSystem.readAsStringAsync(uri);
  return parseVectorImport(request.filename, text).bbox;
}
