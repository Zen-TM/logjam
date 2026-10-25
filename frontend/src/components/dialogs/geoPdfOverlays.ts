import {
  TERRAIN_LAYER_KEYS,
  takesNswContours,
  takesNswHillshade,
  type TerrainLayerKey,
} from "@logjam/shared";
import { TOPO_LAYERS, type CompletedTopoJob } from "../../topoLayerTypes";

// What a GeoPDF draws over its base layer. Contours, slope and hillshade name
// the Terrain group: the statewide layers anywhere in NSW, and a LiDAR job's
// own layer of that name over its area. The rest come only from a job.

const TERRAIN: readonly string[] = TERRAIN_LAYER_KEYS;

/** The overlays a job alone can draw, in the order the renderer stacks them. */
export const LIDAR_ONLY_OVERLAYS = TOPO_LAYERS.filter(
  // Nothing draws `features`, and the API refuses it.
  (layer) => !TERRAIN.includes(layer.name) && layer.name !== "features",
);

/** What a new GeoPDF opens with, before the Terrain group's own rule. */
export const seedOverlays = (): Set<string> =>
  new Set(LIDAR_ONLY_OVERLAYS.map((layer) => layer.name));

/**
 * Whether a job the renderer draws, the user's own, lies in the area. True
 * when a job has no stored footprint or the area is not set yet: never
 * wrongly hides. Shared jobs are left out because the renderer leaves them out.
 */
export function ownJobInArea(
  jobs: readonly CompletedTopoJob[],
  area: { north: number; south: number; east: number; west: number },
): boolean {
  const own = jobs.filter((job) => job.syncRole === "owner");
  if (own.length === 0) return false;
  if (area.north <= area.south || area.east <= area.west) return true;
  return own.some((job) => {
    if (!job.footprint) return true;
    const rings =
      job.footprint.type === "Polygon"
        ? job.footprint.coordinates
        : job.footprint.coordinates.flat();
    let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of rings.flat()) {
      west = Math.min(west, x!);
      east = Math.max(east, x!);
      south = Math.min(south, y!);
      north = Math.max(north, y!);
    }
    if (!Number.isFinite(west)) return true;
    return (
      east > area.west &&
      west < area.east &&
      north > area.south &&
      south < area.north
    );
  });
}

/**
 * The overlays the form shows and sends. Until the user ticks or unticks a
 * Terrain layer (or the last remembered settings set them), each one follows the map: on where
 * the map shows it (shared/DESIGN.md §11, a preview shows the result as it
 * will be made), and on wherever a job of theirs in the area draws its own,
 * which it printed before the statewide layers existed.
 *
 * A job in the area turns the layer on for the whole sheet, statewide
 * included, whether or not the map shows that job: the wire names cannot tell
 * the job's layer from the statewide one.
 */
export function shownOverlays(
  chosen: ReadonlySet<string>,
  terrainFollowsMap: boolean,
  terrain: Readonly<Record<TerrainLayerKey, boolean>>,
  jobInArea: boolean,
): Set<string> {
  if (!terrainFollowsMap) return new Set(chosen);
  return new Set([
    ...[...chosen].filter((name) => !TERRAIN.includes(name)),
    ...TERRAIN_LAYER_KEYS.filter((key) => terrain[key] || jobInArea),
  ]);
}

/**
 * Whether ticking Contours could draw nothing: the base layer prints its own,
 * so the statewide lines stay off it as they do on the map, and no LiDAR job
 * of the user's is in the area to draw its own.
 */
export function contoursPrintedHere(
  baseLayer: string,
  lidarOverlap: boolean,
): boolean {
  return !takesNswContours(baseLayer) && !lidarOverlap;
}

/** Whether ticking Hillshade could draw nothing useful: imagery has its own shadows. */
export function hillshadeShadowedHere(baseLayer: string): boolean {
  return !takesNswHillshade(baseLayer);
}
