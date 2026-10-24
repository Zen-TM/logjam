// A TileJSON the phone writes for a source MLRN can't describe in props: MLRN
// 11's sources take no `bounds`, but MapLibre Native reads them from a
// TileJSON at the source's `url` (terrainRoutes.ts).
//
// PRIVACY: a routed TileJSON's bounds are an area's tile range. The files are
// a store of their own, wiped with the account (TILEJSON_DIR), and nothing
// here logs.
import { Directory, File } from "expo-file-system";

import { TILEJSON_DIR } from "../offline/localStores";
import { hashKey } from "./sourceResolver";

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
 * changes exactly when its TileJSON does. Written again whenever the file is
 * gone: a sign-out wipes the directory, and the OS may clear the cache.
 */
export function tileJsonUrl(json: TileJson): string {
  const text = JSON.stringify({ tilejson: "3.0.0", scheme: "xyz", ...json });
  const file = new File(`${TILEJSON_DIR}${hashKey(text)}.json`);
  if (!file.exists) {
    const dir = new Directory(TILEJSON_DIR);
    if (!dir.exists) dir.create({ intermediates: true });
    file.create();
    file.write(text);
  }
  return file.uri;
}
