import {
  regionInView,
  REGIONS,
  WORLD,
  wrapView,
  type Region,
} from "@logjam/shared";

import type { Viewport } from "./sourceResolver";

/**
 * The one region the Terrain group draws from: the one under the centre of
 * what is on screen (`regionInView`). Before the map first settles there is no
 * viewport, so the camera's own point stands in. The same `Region` comes back
 * until the map crosses into another, so what depends on it changes only then.
 * Guard: `terrainRegion.test.ts`.
 */
export function regionShown(
  viewport: Viewport | null,
  camera: { latitude: number; longitude: number },
  regions: readonly Region[] = REGIONS,
  world: Region = WORLD,
): Region | null {
  const box = viewport ?? {
    west: camera.longitude,
    east: camera.longitude,
    south: camera.latitude,
    north: camera.latitude,
  };
  return regionInView(wrapView(box), regions, world);
}
