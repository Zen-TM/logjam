// A sharpened area's archives on the map: each named by a fixed address that
// a request transform turns into the area's current presigned URL.
//
// The completed-overlays list signs new URLs every time it loads. Written
// into a source, each new URL would remount the source and drop the tiles it
// holds; behind a fixed address, a new URL only replaces the transform. The
// `.invalid` host never resolves (RFC 2606), so a request no transform
// matches fails instead of leaving the phone.
//
// PRIVACY: a presigned URL is a bearer credential. Nothing here logs. MLRN
// writes each transformed URL to its JS log at its debug level, which Logjam
// GPS never sets (sharpenedArchives.test.ts, "never turns MLRN's logging up");
// natively it writes them to logcat only where the `TransformRequestInterceptor`
// log tag is set to DEBUG on the device, and to NSLog in an iOS debug build.
// The sign-out wipe drops every transform (`stopSharpenedAreasForWipe`).
import { TransformRequestManager } from "@maplibre/maplibre-react-native";
import {
  SHARPENED_ARCHIVE_URL,
  TERRAIN_ARCHIVE_LAYERS,
  type SharpenedOverlay,
} from "@logjam/shared";

import { sharpenedArchiveAddress } from "./terrainRoutes";

/**
 * The transforms that serve `areas`' archives, by transform id: each fixed
 * address, replaced by the presigned URL, its `\` and `$` escaped (Kotlin's
 * `Regex.replace` reads `$1` as a group).
 */
export function sharpenedArchiveTransforms(
  areas: readonly SharpenedOverlay[],
): Map<string, { match: string; find: string; replace: string }> {
  const transforms = new Map<
    string,
    { match: string; find: string; replace: string }
  >();
  for (const area of areas)
    for (const layer of TERRAIN_ARCHIVE_LAYERS) {
      const url = area[SHARPENED_ARCHIVE_URL[layer]];
      if (!url) continue;
      // Its dots match any character, harmlessly: an id is a UUID.
      const pattern = `^${sharpenedArchiveAddress(area.id, layer)}`;
      transforms.set(`sharpened-${area.id}-${layer}`, {
        match: pattern,
        find: pattern,
        replace: url.replace(/[\\$]/g, "\\$&"),
      });
    }
  return transforms;
}

// Bumped by the sign-out wipe: a list asked for before it (`inAreasEpoch`)
// serves nothing after it, and its TileJSONs are not written (tileJsonFile.ts).
let epoch = 0;

/** The epoch now: a list asked for in it may be served until the next wipe. */
export const sharpenedAreasEpoch = (): number => epoch;

// The transform ids installed, or null before the first serve of this JS
// context: MLRN's transforms are native and outlive a JS reload.
let installed: Set<string> | null = null;

/**
 * Called by the sign-out wipe: every transform goes, and no list asked for
 * before it is served again. The map stays mounted while the wipe runs.
 */
export function stopSharpenedAreasForWipe(): void {
  epoch += 1;
  TransformRequestManager.clearUrlTransforms();
  installed = new Set();
}

/**
 * Point the fixed addresses at `areas`' current URLs, and drop the ones of
 * areas no longer listed (deleted or unshared). Called while the map renders,
 * before the sources that read them mount: MLRN applies both on the UI
 * thread, in the order they were sent.
 */
export function serveSharpenedArchives(
  areas: readonly SharpenedOverlay[],
  areasEpoch: number,
): void {
  if (areasEpoch !== epoch) return;
  if (installed === null) TransformRequestManager.clearUrlTransforms();
  const transforms = sharpenedArchiveTransforms(areas);
  for (const id of installed ?? [])
    if (!transforms.has(id)) TransformRequestManager.removeUrlTransform(id);
  for (const [id, transform] of transforms)
    TransformRequestManager.addUrlTransform({ id, ...transform });
  installed = new Set(transforms.keys());
}

/**
 * `request`'s answer, with the epoch it was asked in. A list still in flight
 * when the sign-out wipe runs lands with the epoch before it, so it is never
 * served and its TileJSONs are never written (sharpenedArchives.test.ts,
 * "never serves a list that was in flight when the sign-out wipe ran").
 */
export async function inAreasEpoch<T extends object>(
  request: () => Promise<T>,
): Promise<T & { areasEpoch: number }> {
  const areasEpoch = epoch;
  return { ...(await request()), areasEpoch };
}

/**
 * The areas a completed-overlays list shows the user, with the epoch the list
 * was asked in, never the one it lands in, so a list in flight at sign-out is
 * stopped by the wipe. None for a guest: the list keeps its last answer once
 * its query is disabled. Guard: sharpenedArchives.test.ts, "gives a list in
 * flight at sign-out the epoch it was asked in" and "shows a guest no area".
 */
export function sharpenedAreasOf(
  list: { jobs: { sharpened?: SharpenedOverlay }[]; areasEpoch: number } | null,
  signedIn: boolean,
): { sharpenedAreas: SharpenedOverlay[]; areasEpoch: number } {
  if (!list || !signedIn) return { sharpenedAreas: [], areasEpoch: epoch };
  return {
    sharpenedAreas: list.jobs.flatMap((job) =>
      job.sharpened ? [job.sharpened] : [],
    ),
    areasEpoch: list.areasEpoch,
  };
}
