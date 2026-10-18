// Which basemap the map opens on (whatever the user last chose).
//
// DEVICE-scoped like the compass switch: the answer depends on what this phone
// has downloaded, and a basemap is a view preference, not account data. Same
// tiny synchronous store, for the same reason — the map's FIRST frame has to be
// the right one, and a basemap that swaps a beat after the screen appears
// re-fetches every tile it just drew.
import { normalizeTerrainLayers, type TerrainLayerKey } from "@logjam/shared";

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
export function readTerrainLayers(): Record<TerrainLayerKey, boolean> {
  try {
    return normalizeTerrainLayers(
      JSON.parse(readPref(TERRAIN_LAYERS_PREF_KEY) ?? "null"),
    );
  } catch {
    return normalizeTerrainLayers(null);
  }
}

export function setTerrainLayers(
  layers: Record<TerrainLayerKey, boolean>,
): boolean {
  return writePref(TERRAIN_LAYERS_PREF_KEY, JSON.stringify(layers));
}

/** False when the device refused to store it, so the caller can say so. */
export function setBasemapPreference(basemapId: BasemapId): boolean {
  return writePref(BASEMAP_PREF_KEY, basemapId);
}
