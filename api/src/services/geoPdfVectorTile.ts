// Pure vector-tile decode for the GeoPDF render path.
//
// Extracted from generateGeoPdf.ts so the pbf-decode seam can be unit-tested in
// isolation from canvas/network/PMTiles. The vector-tile3 / pbf5 bump rewrote
// exactly this call (`new VectorTile(new PbfReader(...))`) and shipped verified
// by tsc only — this module + geoPdfVectorTile.unit.test.ts is the regression
// guard that bump never got. Rendering (renderVectorFeature) stays in
// generateGeoPdf.ts; this layer only turns tile bytes into features.

import { VectorTile, VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

export interface DecodedTileLayer {
  /**
   * True if the named source layer exists in the tile — even when it holds zero
   * features. The render path credits a layer in the attribution block based on
   * presence (not feature count), so this distinction must survive extraction.
   */
  present: boolean;
  features: VectorTileFeature[];
}

/**
 * Decode `data` (raw PMTiles tile bytes) and return the features of `layerName`.
 * Returns `{ present: false, features: [] }` when the layer is absent. Throws on
 * malformed protobuf — callers in the render path already wrap this in a
 * try/catch that logs and skips the tile.
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
