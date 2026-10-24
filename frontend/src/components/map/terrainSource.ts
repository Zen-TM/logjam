// Which DEM Logjam Web's 3D terrain is drawn from.
//
// MapLibre takes ONE raster-dem source, so terrain cannot walk the list in
// shared/src/demSources.ts the way a height lookup does. The choice is made
// when 3D is switched on, and again when the user's sharpened areas change:
// the NSW archive when the map is looking at NSW and the archive opens,
// otherwise the worldwide tiles. With sharpened areas the NSW source reads the
// terrain router (terrainRouter.ts), so a tile inside an area comes from that
// area and the rest from the 5 m archive, with one precedence for 2D and 3D.
import type { Map as MapLibreMap } from "maplibre-gl";
import { NSW_5M, NSW_HILLSHADE, type SharpenedOverlay } from "@logjam/shared";
import {
  areasKey,
  routedAttribution,
  terrainTileTemplate,
} from "./terrainRouter";

export const WORLDWIDE_TERRAIN_SOURCE = "3d-terrain-dem";
export const NSW_TERRAIN_SOURCE = "3d-terrain-dem-nsw";

/**
 * The terrain source to use for where the map is now. Adds the NSW source the
 * first time it is chosen, and only after `openArchive` has shown the archive
 * is there: a raster-dem source over a missing archive draws nothing and
 * raises a source error on every tile.
 */
export async function terrainSourceFor(
  map: Pick<MapLibreMap, "getCenter" | "getSource" | "addSource">,
  areas: readonly SharpenedOverlay[],
  /** Rejects when the archive at this URL cannot be opened. */
  openArchive: (url: string) => Promise<unknown>,
  origin: string,
): Promise<string> {
  // Wrapped: after a pan around the world the centre's longitude is a turn
  // or more away from the one the coverage is written in.
  const { lng, lat } = map.getCenter().wrap();
  const [west, south, east, north] = NSW_5M.coverage;
  if (lng < west || lng > east || lat < south || lat > north)
    return WORLDWIDE_TERRAIN_SOURCE;
  // One source per set of areas, as the 2D layers have: a new set has a new
  // zmax and no tile cached from the old one.
  const id = areas.length
    ? `${NSW_TERRAIN_SOURCE}-${areasKey(areas)}`
    : NSW_TERRAIN_SOURCE;
  if (map.getSource(id)) return id;
  // Same-origin, like the vector basemap: prod serves /master/* from the web
  // distribution and the dev server proxies it (vite.config.ts).
  const url = `${origin}/${NSW_5M.archivePath}`;
  try {
    await openArchive(url);
  } catch {
    return WORLDWIDE_TERRAIN_SOURCE;
  }
  // Asked again: a second call may have added it while this one waited.
  if (map.getSource(id)) return id;
  map.addSource(
    id,
    areas.length
      ? {
          type: "raster-dem",
          tiles: [terrainTileTemplate("hillshade", areas)],
          // An absent tile (past an area's zmax, or past z15 outside every
          // area) is overzoomed from its parent by MapLibre, as in 2D.
          minzoom: NSW_HILLSHADE.minzoom,
          maxzoom: Math.max(...areas.map((a) => a.zmax)),
          bounds: [...NSW_5M.coverage],
          tileSize: 256,
          encoding: "terrarium",
          attribution: routedAttribution(NSW_5M.creditHtml, areas),
        }
      : {
          type: "raster-dem",
          url: `pmtiles://${url}`,
          tileSize: 256,
          encoding: "terrarium",
          attribution: NSW_5M.creditHtml,
        },
  );
  return id;
}

/** Removes the NSW terrain sources a newer choice has replaced. */
export function dropStaleTerrainSources(
  map: Pick<MapLibreMap, "getStyle" | "removeSource">,
  keep: string,
): void {
  for (const id of Object.keys(map.getStyle().sources ?? {}))
    if (id.startsWith(NSW_TERRAIN_SOURCE) && id !== keep) map.removeSource(id);
}
