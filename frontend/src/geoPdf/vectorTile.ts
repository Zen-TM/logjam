// Pure vector-tile decode for the GeoPDF render path.
//
// Kept separate from canvas/network/PMTiles so the pbf-decode seam
// (`new VectorTile(new PbfReader(...))`) can be unit-tested in isolation.
// Guard: vectorTile.test.ts. Drawing is in draw/contours.ts; this layer only
// turns tile bytes into features. A port of api/src/services/geoPdfVectorTile.ts.

import { VectorTile, VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

export interface DecodedTileLayer {
  /**
   * True if the named source layer exists in the tile — even when it holds zero
   * features. The render path credits a layer in the attribution block based on
   * presence (not feature count), so this distinction is preserved.
   */
  present: boolean;
  features: VectorTileFeature[];
}

/**
 * Decode `data` (raw PMTiles tile bytes) and return the features of `layerName`.
 * Returns `{ present: false, features: [] }` when the layer is absent. Throws on
 * malformed protobuf — callers in the render path already wrap this in a
 * try/catch that skips the tile.
 */
export function decodeVectorTileLayer(
  data: Uint8Array | ArrayBuffer,
  layerName: string,
): DecodedTileLayer {
  const tile = new VectorTile(new PbfReader(data));
  const layer = tile.layers[layerName];
  if (!layer) return { present: false, features: [] };
  const features: VectorTileFeature[] = [];
  for (let i = 0; i < layer.length; i++) {
    features.push(layer.feature(i));
  }
  return { present: true, features };
}
