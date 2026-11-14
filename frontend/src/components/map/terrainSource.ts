// Which DEM Logjam Web's 3D terrain is drawn from.
//
// MapLibre takes ONE raster-dem source, so terrain cannot walk the list in
// shared/src/demSources.ts the way a height lookup does. The choice is made
// when 3D is switched on, and again when the user's sharpened areas change:
// the heights of the region the map shows (the one `regionInWrappedView`
// names, as for the Terrain group) when it has them and the archive opens,
// otherwise the worldwide tiles. With sharpened areas the region's source
// reads the terrain router (terrainRouter.ts), so a tile inside an area comes
// from that area and the rest from the region's own archive, with one
// precedence for 2D and 3D.
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  areasInRegion,
  layerIn,
  regionInWrappedView,
  REGIONS,
  type Region,
  type SharpenedOverlay,
  WORLD,
} from "@logjam/shared";
import {
  areasKey,
  routedAttribution,
  terrainTileTemplate,
} from "./terrainRouter";

export const WORLDWIDE_TERRAIN_SOURCE = "3d-terrain-dem";
/** A region's source is this and its id; a region id has no dash, so no id is another's prefix. */
export const REGION_TERRAIN_SOURCE = "3d-terrain-dem-";

/**
 * The terrain source to use for where the map is now. Adds the region's source
 * the first time it is chosen, and only after `openArchive` has shown the
 * archive is there: a raster-dem source over a missing archive draws nothing and
 * raises a source error on every tile.
 */
export async function terrainSourceFor(
  map: Pick<MapLibreMap, "getBounds" | "getSource" | "addSource">,
  areas: readonly SharpenedOverlay[],
  /** Rejects when the archive at this URL cannot be opened. */
  openArchive: (url: string) => Promise<unknown>,
  origin: string,
  /** The regions a view is read against, and the tier under them: what the map shows by default. */
  regions: readonly Region[] = REGIONS,
  world: Region = WORLD,
): Promise<string> {
  // Raw longitudes: a map panned round the world reports them past ±180,
  // which `regionInWrappedView` reads back into a region's range.
  const bounds = map.getBounds();
  const region = regionInWrappedView(
    {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    },
    regions,
    world,
  );
  const heights = layerIn(region, "heights");
  if (!region || !heights) return WORLDWIDE_TERRAIN_SOURCE;
  // Only the areas this region holds are routed, as in the Terrain group, and
  // the router needs the region's hillshade archive to read its own tiles.
  const held = areasInRegion(region, areas);
  const shade = held.length ? layerIn(region, "hillshade") : null;
  // One source per set of areas, as the 2D layers have: a new set has a new
  // zmax and no tile cached from the old one.
  const id = shade
    ? `${REGION_TERRAIN_SOURCE}${region.id}-${areasKey(held)}`
    : `${REGION_TERRAIN_SOURCE}${region.id}`;
  if (map.getSource(id)) return id;
  // Same-origin, like the vector basemap: prod serves /master/* from the web
  // distribution and the dev server proxies it (vite.config.ts).
  const url = `${origin}/${heights.archivePath}`;
  try {
    await openArchive(url);
  } catch {
    return WORLDWIDE_TERRAIN_SOURCE;
  }
  // Asked again: a second call may have added it while this one waited.
  if (map.getSource(id)) return id;
  map.addSource(
    id,
    shade
      ? {
          type: "raster-dem",
          tiles: [terrainTileTemplate(region, "hillshade", held)],
          // An absent tile (past an area's zmax, or past z15 outside every
          // area) is overzoomed from its parent by MapLibre, as in 2D.
          minzoom: shade.minzoom,
          maxzoom: Math.max(...held.map((a) => a.zmax)),
          bounds: [...heights.coverage],
          tileSize: 256,
          encoding: "terrarium",
          attribution: routedAttribution(heights.creditHtml, held),
        }
      : {
          type: "raster-dem",
          url: `pmtiles://${url}`,
          tileSize: 256,
          encoding: "terrarium",
          attribution: heights.creditHtml,
        },
  );
  return id;
}

/** Removes the regions' terrain sources a newer choice has replaced. */
export function dropStaleTerrainSources(
  map: Pick<MapLibreMap, "getStyle" | "removeSource">,
  keep: string,
): void {
  for (const id of Object.keys(map.getStyle().sources ?? {}))
    if (id.startsWith(REGION_TERRAIN_SOURCE) && id !== keep)
      map.removeSource(id);
}

/**
 * Draws 3D terrain from the source for `areas`, then drops the sources it
 * replaces. `isCurrent` is asked after the archive opens: a newer toggle, or a
 * removed map, makes this answer stale and nothing is drawn.
 */
export async function applyTerrain(
  map: Pick<
    MapLibreMap,
    | "getBounds"
    | "getSource"
    | "addSource"
    | "getStyle"
    | "removeSource"
    | "setTerrain"
    | "once"
  >,
  areas: readonly SharpenedOverlay[],
  openArchive: (url: string) => Promise<unknown>,
  origin: string,
  isCurrent: () => boolean,
  /** Runs once the terrain tiles have loaded (the auto-tilt on turning 3D on). */
  afterIdle?: () => void,
): Promise<void> {
  const source = await terrainSourceFor(map, areas, openArchive, origin);
  if (!isCurrent()) return;
  map.setTerrain({ source, exaggeration: 1 });
  dropStaleTerrainSources(map, source);
  if (afterIdle) map.once("idle", afterIdle);
}
