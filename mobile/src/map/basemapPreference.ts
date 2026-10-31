// Which basemap the map opens on (whatever the user last chose).
//
// DEVICE-scoped like the compass switch: the answer depends on what this phone
// has downloaded, and a basemap is a view preference, not account data. Same
// tiny synchronous store, for the same reason — the map's FIRST frame has to be
// the right one, and a basemap that swaps a beat after the screen appears
// re-fetches every tile it just drew.
import { normalizeTerrainLayers, type TerrainSwitchKey } from "@logjam/shared";

import { readPref, writePref } from "../prefsDb";
import { DEFAULT_BASEMAP, MOBILE_BASEMAPS } from "./basemapMeta";
import type { BasemapId } from "./sourceResolver";

const BASEMAP_PREF_KEY = "mapBasemapId";

/** The last chosen basemap, or the default when nothing usable is recorded. */
export function readBasemapPreference(): BasemapId {
  const stored = readPref(BASEMAP_PREF_KEY);
  // An id we no longer offer (a removed source, an older build's pick) reads as
  // "nothing recorded" rather than throwing out of the resolver later.
  return MOBILE_BASEMAPS.find((id) => id === stored) ?? DEFAULT_BASEMAP;
}

const TERRAIN_LAYERS_PREF_KEY = "mapTerrainLayers";

/** The Terrain group's switches (shared terrain.ts), defaults where unset. */
export function readTerrainLayers(): Record<TerrainSwitchKey, boolean> {
  try {
    return normalizeTerrainLayers(
      JSON.parse(readPref(TERRAIN_LAYERS_PREF_KEY) ?? "null"),
    );
  } catch {
    return normalizeTerrainLayers(null);
  }
}

export function setTerrainLayers(
  layers: Record<TerrainSwitchKey, boolean>,
): boolean {
  return writePref(TERRAIN_LAYERS_PREF_KEY, JSON.stringify(layers));
}

const GAUGES_PREF_KEY = "mapGaugesLayer";

/** The river gauge layer, off until the user switches it on. */
export const readGaugesLayer = (): boolean =>
  readPref(GAUGES_PREF_KEY) === "on";

export const setGaugesLayer = (on: boolean): boolean =>
  writePref(GAUGES_PREF_KEY, on ? "on" : "off");

/** False when the device refused to store it, so the caller can say so. */
export function setBasemapPreference(basemapId: BasemapId): boolean {
  return writePref(BASEMAP_PREF_KEY, basemapId);
}

const TERRAIN_3D_PREF_KEY = "map3dTerrain";

/** 3D terrain costs frames and battery, so it is off until switched on. */
export const readTerrain3d = (): boolean =>
  readPref(TERRAIN_3D_PREF_KEY) === "on";

export const setTerrain3d = (on: boolean): boolean =>
  writePref(TERRAIN_3D_PREF_KEY, on ? "on" : "off");
