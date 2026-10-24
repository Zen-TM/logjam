// A TileJSON the phone writes for a source MLRN can't describe in props: MLRN
// 11's sources take no `bounds`, but MapLibre Native reads them from a
// TileJSON at the source's `url` (terrainRoutes.ts).
//
// PRIVACY: a routed TileJSON's bounds are an area's tile range. The files are
// a store of their own, wiped with the account (TILEJSON_DIR), none is written
// for a list read before that wipe, and nothing here logs.
import { Directory, File } from "expo-file-system";

import { TILEJSON_DIR } from "../offline/localStores";
import { sharpenedAreasEpoch } from "./sharpenedArchives";
import { hashKey, type ResolvedTileSource } from "./sourceResolver";

type DrawnSource = Extract<ResolvedTileSource, { status: "ok" }>;

/** The TileJSON fields Logjam writes (tilejson 3.0.0). */
export type TileJson = {
  tiles: string[];
  minzoom: number;
  maxzoom: number;
  bounds: [number, number, number, number];
  /** A `url` source reads its DEM encoding here, not from its props. */
  encoding?: "terrarium";
};

/**
 * A `file://` URL holding `json`, named by its content so a source's URL
 * changes exactly when its TileJSON does, or null when it can't be written.
 * Written again whenever the file is gone: the OS may clear the cache.
 */
function tileJsonUrl(json: TileJson): string | null {
  const text = JSON.stringify({ tilejson: "3.0.0", scheme: "xyz", ...json });
  const file = new File(`${TILEJSON_DIR}${hashKey(text)}.json`);
  try {
    if (!file.exists) {
      const dir = new Directory(TILEJSON_DIR);
      if (!dir.exists) dir.create({ intermediates: true });
      file.write(text);
    }
    return file.uri;
  } catch (err) {
    // A full disk, say. A half-written file would be read as it is, so it goes.
    console.error(err);
    try {
      if (file.exists) file.delete();
    } catch {
      // Nothing more to do: the map draws statewide instead.
    }
    return null;
  }
}

/**
 * `sources` with each TileJSON written and its `url` set. When one can't be
 * written, or the list of areas was read before a sign-out wipe
 * (`areasEpoch`), the statewide source alone at every zoom: an area then
 * draws as statewide, never as a hole.
 */
export function writeTileJsons(
  sources: readonly DrawnSource[],
  areasEpoch: number,
): DrawnSource[] {
  if (!sources.some((s) => s.tileJson)) return [...sources];
  if (areasEpoch === sharpenedAreasEpoch()) {
    const written = sources.map((s) => {
      if (!s.tileJson) return s;
      const url = tileJsonUrl(s.tileJson);
      return url ? { ...s, url } : null;
    });
    if (written.every((s) => s !== null)) return written;
  }
  return sources.flatMap((s) => {
    if (s.tileJson) return [];
    const { layerMaxZoom: _drop, ...statewide } = s;
    return [statewide];
  });
}
