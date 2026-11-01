import {
  NSW_5M,
  NSW_LAND,
  type SharpenedOverlay,
  type TerrainLayerKey,
} from "@logjam/shared";

import {
  TERRAIN_STATEWIDE,
  routedAttribution,
  terrainTileTemplate,
  type RoutedTerrainKey,
} from "./terrainRouter";

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
    pmtilesUrl: `${window.location.origin}/${TERRAIN_STATEWIDE.contours.archivePath}`,
    format: "vector" as const,
    attribution: TERRAIN_STATEWIDE.contours.creditHtml,
  },
  slope: {
    id: "nswslope",
    pmtilesUrl: `${window.location.origin}/${TERRAIN_STATEWIDE.slope.archivePath}`,
    format: "slope" as const,
    attribution: TERRAIN_STATEWIDE.slope.creditHtml,
  },
  land: {
    id: "nswland",
    pmtilesUrl: `${window.location.origin}/${NSW_LAND.archivePath}`,
    format: "land" as const,
    attribution: NSW_LAND.creditHtml,
  },
  hillshade: {
    id: "nswhillshade",
    pmtilesUrl: `${window.location.origin}/${TERRAIN_STATEWIDE.hillshade.archivePath}`,
    format: "hillshade" as const,
    attribution: TERRAIN_STATEWIDE.hillshade.creditHtml,
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
  const routed = (key: RoutedTerrainKey, maxzoom: number) => {
    const statewide = TERRAIN_STATEWIDE[key];
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
    contours: routed("contours", TERRAIN_STATEWIDE.contours.maxzoom),
    slope: routed("slope", deepest),
    land: TERRAIN_ENTRIES.land,
    hillshade: routed("hillshade", deepest),
  };
}
