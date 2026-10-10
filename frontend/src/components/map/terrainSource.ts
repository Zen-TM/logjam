// Which DEM Logjam Web's 3D terrain is drawn from.
//
// MapLibre takes ONE raster-dem source, so terrain cannot walk the list in
// shared/src/demSources.ts the way a height lookup does. The choice is made
// once, when 3D is switched on: the NSW archive when the map is looking at
// NSW and the archive opens, otherwise the worldwide tiles.
import type { Map as MapLibreMap } from "maplibre-gl";
import { NSW_5M } from "@logjam/shared";

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
  /** Rejects when the archive at this URL cannot be opened. */
  openArchive: (url: string) => Promise<unknown>,
  origin: string,
): Promise<string> {
  const { lng, lat } = map.getCenter();
  const [west, south, east, north] = NSW_5M.coverage;
  if (lng < west || lng > east || lat < south || lat > north)
    return WORLDWIDE_TERRAIN_SOURCE;
  if (map.getSource(NSW_TERRAIN_SOURCE)) return NSW_TERRAIN_SOURCE;
  // Same-origin, like the vector basemap: prod serves /master/* from the web
  // distribution and the dev server proxies it (vite.config.ts).
  const url = `${origin}/${NSW_5M.archivePath}`;
  try {
    await openArchive(url);
  } catch {
    return WORLDWIDE_TERRAIN_SOURCE;
  }
  map.addSource(NSW_TERRAIN_SOURCE, {
    type: "raster-dem",
    url: `pmtiles://${url}`,
    tileSize: 256,
    encoding: "terrarium",
    attribution: NSW_5M.creditHtml,
  });
  return NSW_TERRAIN_SOURCE;
}
