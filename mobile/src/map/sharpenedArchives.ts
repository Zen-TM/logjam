// A sharpened area's archives on the map: each named by a fixed address that
// a request transform turns into the area's current presigned URL.
//
// The completed-overlays list signs new URLs every time it loads. Written
// into a source, each new URL would remount the source and drop the tiles it
// holds; behind a fixed address, a new URL only replaces the transform. The
// `.invalid` host never resolves (RFC 2606), so a request no transform
// matches fails instead of leaving the phone.
//
// PRIVACY: a presigned URL is a bearer credential. Nothing here logs, and
// MLRN logs a transformed URL only at its debug level, which Logjam GPS never
// sets (sharpenedArchives.test.ts, "never turns MLRN's logging up").
import { TransformRequestManager } from "@maplibre/maplibre-react-native";
import type { SharpenedOverlay, TerrainArchiveLayer } from "@logjam/shared";

import { sharpenedArchiveAddress } from "./terrainRoutes";

const URL_FIELD = {
  heights: "heightsUrl",
  slope: "slopeUrl",
  contours: "contoursUrl",
} as const satisfies Record<TerrainArchiveLayer, keyof SharpenedOverlay>;

/**
 * The transforms that serve `areas`' archives, by transform id: each fixed
 * address, replaced by the presigned URL, its `\` and `$`
 * escaped (Kotlin's `Regex.replace` reads `$1` as a group).
 */
export function sharpenedArchiveTransforms(
  areas: readonly SharpenedOverlay[],
): Map<string, { match: string; find: string; replace: string }> {
  const transforms = new Map<
    string,
    { match: string; find: string; replace: string }
  >();
  for (const area of areas)
    for (const layer of ["heights", "slope", "contours"] as const) {
      const url = area[URL_FIELD[layer]];
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

let installed = new Set<string>();

/**
 * Point the fixed addresses at `areas`' current URLs, and drop the ones of
 * areas no longer listed (deleted, unshared, or signed out). Called while the
 * map renders, before the sources that read them mount: MLRN applies both
 * on the UI thread, in the order they were sent.
 */
export function serveSharpenedArchives(
  areas: readonly SharpenedOverlay[],
): void {
  const transforms = sharpenedArchiveTransforms(areas);
  for (const id of installed)
    if (!transforms.has(id)) TransformRequestManager.removeUrlTransform(id);
  for (const [id, transform] of transforms)
    TransformRequestManager.addUrlTransform({ id, ...transform });
  installed = new Set(transforms.keys());
}
