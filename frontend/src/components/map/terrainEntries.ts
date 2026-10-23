import {
  NSW_CONTOURS,
  NSW_HILLSHADE,
  NSW_SLOPE,
  type TerrainLayerKey,
} from "@logjam/shared";

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
