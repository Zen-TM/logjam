import {
  NSW_5M,
  NSW_CONTOURS,
  NSW_HILLSHADE,
  NSW_SLOPE,
  type SharpenedOverlay,
  type TerrainLayerKey,
} from "@logjam/shared";

import { routedAttribution, terrainTileTemplate } from "./terrainRouter";

/**
 * The Terrain group's layers as entries of `topoLayers`, beside the topo
 * areas' layers. Same origin, like the vector basemap: `/master/*` is served
 * by the web distribution and proxied in dev. No id has a dash, and the
 * contours' contains "contours": Map.tsx splits a layer id at its first
 * dash and styles an entry as contours by that word.
 */
export const TERRAIN_ENTRIES = {
  contours: {
    id: "nswcontours",
    pmtilesUrl: `${window.location.origin}/${NSW_CONTOURS.archivePath}`,
    format: "vector" as const,
    attribution: NSW_CONTOURS.creditHtml,
  },
  slope: {
    id: "nswslope",
    pmtilesUrl: `${window.location.origin}/${NSW_SLOPE.archivePath}`,
    format: "slope" as const,
    attribution: NSW_SLOPE.creditHtml,
  },
  hillshade: {
    id: "nswhillshade",
    pmtilesUrl: `${window.location.origin}/${NSW_HILLSHADE.archivePath}`,
    format: "hillshade" as const,
    attribution: NSW_HILLSHADE.creditHtml,
  },
} satisfies Record<TerrainLayerKey, unknown>;

/** A tile source the router answers, in place of an archive's own URL. */
export type RoutedTiles = {
  template: string;
  minzoom: number;
  maxzoom: number;
  bounds: readonly [number, number, number, number];
};

/**
 * The Terrain group's entries for a user who can see `areas`: today's
 * entries when there are none (nothing changes for them), else each layer
 * read through the router (terrainRouter.ts), to the deepest zoom an area
 * holds. Contours stop at z14 either way, and deeper zooms overzoom it.
 */
export function terrainEntries(
  areas: readonly SharpenedOverlay[],
): Record<
  TerrainLayerKey,
  (typeof TERRAIN_ENTRIES)[TerrainLayerKey] & { tiles?: RoutedTiles }
> {
  if (areas.length === 0) return TERRAIN_ENTRIES;
  const deepest = Math.max(...areas.map((a) => a.zmax));
  const routed = (
    key: TerrainLayerKey,
    statewide: { minzoom: number; maxzoom: number; creditHtml: string },
    maxzoom: number,
  ) => {
    const template = terrainTileTemplate(key, areas);
    return {
      ...TERRAIN_ENTRIES[key],
      // In the source key, so a new set of areas gets a new source.
      pmtilesUrl: template,
      attribution: routedAttribution(statewide.creditHtml, areas),
      tiles: {
        template,
        minzoom: statewide.minzoom,
        maxzoom,
        bounds: NSW_5M.coverage,
      },
    };
  };
  return {
    contours: routed("contours", NSW_CONTOURS, NSW_CONTOURS.maxzoom),
    slope: routed("slope", NSW_SLOPE, deepest),
    hillshade: routed("hillshade", NSW_HILLSHADE, deepest),
  };
}
