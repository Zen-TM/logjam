// The "Map data" sheet's credit for what the map draws from tiles: the
// basemap and every Terrain layer, as Logjam Web's attribution control shows
// them (frontend/src/components/App.tsx).
import { TERRAIN_LAYER_KEYS, type TerrainLayerKey } from "@logjam/shared";

import type { ResolvedTileSource } from "./sourceResolver";

/** Once each: offline, every saved clip of a source carries the same credit. */
export function mapDataAttribution(
  basemap: readonly ResolvedTileSource[],
  terrain: Readonly<Record<TerrainLayerKey, readonly ResolvedTileSource[]>>,
): string {
  return [
    ...new Set(
      [basemap, ...TERRAIN_LAYER_KEYS.map((key) => terrain[key])]
        .flat()
        .map((r) => (r.status === "ok" ? r.attribution : null))
        .filter(Boolean),
    ),
  ].join(" · ");
}
