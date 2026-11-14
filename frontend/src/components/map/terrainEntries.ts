import {
  layerIn,
  type Region,
  type SharpenedOverlay,
  type TerrainLayerKey,
} from "@logjam/shared";

import { terrainEntryId } from "./layerOrder";
import {
  areasIn,
  isRouted,
  routedAttribution,
  terrainTileTemplate,
} from "./terrainRouter";

/** A tile source the router answers, in place of an archive's own URL. */
export type RoutedTiles = {
  template: string;
  minzoom: number;
  maxzoom: number;
  bounds: readonly [number, number, number, number];
};

/** One Terrain layer as an entry of `topoLayers`, beside the topo areas' layers. */
export type TerrainEntry = {
  id: string;
  pmtilesUrl: string;
  format: "vector" | "slope" | "coverage" | "fire" | "land" | "hillshade";
  attribution: string;
  tiles?: RoutedTiles;
};

/**
 * The Terrain group's layers of `region` as entries of `topoLayers`, beside the
 * topo areas' layers. A layer the region has no archive for has no entry, and
 * a map over no region has none at all. Same origin, like the vector basemap:
 * `/master/*` is served by the web distribution and proxied in dev. An id is
 * `terrainEntryId`'s, with no dash, and the contours' ends in "contours":
 * Map.tsx splits a layer id at its first dash and styles an entry as contours
 * by that word. Guard: `terrainEntries.test.ts` ("names each entry so its
 * layer is read back from the id").
 *
 * For a user who can see sharpened `areas` that `region` holds, the surfaces
 * a sharpened area replaces are read through the router (terrainRouter.ts), to
 * the deepest zoom an area holds. Contours stop at z14 either way, and deeper
 * zooms overzoom it.
 */
export function terrainEntries(
  region: Region | null,
  areas: readonly SharpenedOverlay[],
): Partial<Record<TerrainLayerKey, TerrainEntry>> {
  if (!region) return {};
  const held = areasIn(region, areas);
  const deepest = Math.max(...held.map((a) => a.zmax));

  const entry = (
    key: TerrainLayerKey,
    format: TerrainEntry["format"],
  ): TerrainEntry | null => {
    const archive = layerIn(region, key);
    if (!archive) return null;
    const plain = {
      id: terrainEntryId(region, key),
      pmtilesUrl: `${window.location.origin}/${archive.archivePath}`,
      format,
      attribution: archive.creditHtml,
    };
    if (held.length === 0 || !isRouted(key)) return plain;
    const template = terrainTileTemplate(region, key, held);
    return {
      ...plain,
      // In the source key, so a new set of areas gets a new source.
      pmtilesUrl: template,
      attribution: routedAttribution(archive.creditHtml, held),
      tiles: {
        template,
        minzoom: archive.minzoom,
        maxzoom: key === "contours" ? archive.maxzoom : deepest,
        bounds: layerIn(region, "heights")?.coverage ?? archive.coverage,
      },
    };
  };

  const made = {
    contours: entry("contours", "vector"),
    land: entry("land", "land"),
    coverage: entry("coverage", "coverage"),
    fire: entry("fire", "fire"),
    slope: entry("slope", "slope"),
    hillshade: entry("hillshade", "hillshade"),
  } satisfies Record<TerrainLayerKey, TerrainEntry | null>;
  return Object.fromEntries(
    Object.entries(made).filter(([, entry]) => entry !== null),
  ) as Partial<Record<TerrainLayerKey, TerrainEntry>>;
}
