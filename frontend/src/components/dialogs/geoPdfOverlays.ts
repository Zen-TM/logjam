import {
  TERRAIN_LAYER_KEYS,
  takesNswContours,
  type TerrainLayerKey,
} from "@logjam/shared";
import { TOPO_LAYERS } from "../../topoLayerTypes";

// What a GeoPDF draws over its base layer. Contours, slope and hillshade name
// the Terrain group: the statewide layers anywhere in NSW, and a LiDAR job's
// own layer of that name over its area. The rest come only from a job.

const TERRAIN: readonly string[] = TERRAIN_LAYER_KEYS;

/** The overlays a job alone can draw, in the order the renderer stacks them. */
export const LIDAR_ONLY_OVERLAYS = TOPO_LAYERS.filter(
  (layer) => !TERRAIN.includes(layer.name),
);

/**
 * The overlays a new GeoPDF opens with: the Terrain layers the map shows
 * (shared/DESIGN.md §11, a preview shows the result as it will be made) and
 * every LiDAR-only layer, which shows only where a job has it.
 */
export function seedOverlays(
  terrain: Readonly<Record<TerrainLayerKey, boolean>>,
): Set<string> {
  return new Set([
    ...TERRAIN_LAYER_KEYS.filter((key) => terrain[key]),
    ...LIDAR_ONLY_OVERLAYS.map((layer) => layer.name),
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
