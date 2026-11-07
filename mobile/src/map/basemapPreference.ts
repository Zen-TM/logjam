// Which basemap the map opens on (whatever the user last chose).
//
// DEVICE-scoped like the compass switch: the answer depends on what this phone
// has downloaded, and a basemap is a view preference, not account data. Same
// tiny synchronous store, for the same reason — the map's FIRST frame has to be
// the right one, and a basemap that swaps a beat after the screen appears
// re-fetches every tile it just drew.
import {
  type CarrierId,
  MAP_OVERLAY_DEFAULTS,
  normalizeCarrier,
  normalizeTerrainLayers,
  type TerrainSwitchKey,
  type WeatherLayerKey,
  weatherLayer,
} from "@logjam/shared";

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

const COVERAGE_CARRIER_PREF_KEY = "mapCoverageCarrier";

/** The network the Coverage overlay draws, the default until the user picks. */
export const readCoverageCarrier = (): CarrierId =>
  normalizeCarrier(readPref(COVERAGE_CARRIER_PREF_KEY));

export const setCoverageCarrier = (id: CarrierId): boolean =>
  writePref(COVERAGE_CARRIER_PREF_KEY, id);

const WEATHER_LAYER_PREF_KEY = "mapWeatherLayer";

/** What the Weather overlay draws, the default until the user picks (and for a stored key this build doesn't know). */
export const readWeatherLayer = (): WeatherLayerKey =>
  weatherLayer(readPref(WEATHER_LAYER_PREF_KEY) ?? undefined).key;

export const setWeatherLayer = (key: WeatherLayerKey): boolean =>
  writePref(WEATHER_LAYER_PREF_KEY, key);

const readOverlay = (key: string, fallback: boolean): boolean => {
  const stored = readPref(key);
  return stored === null ? fallback : stored === "on";
};

const GAUGES_PREF_KEY = "mapGaugesLayer";

/** The river gauge layer, off until the user switches it on. */
export const readGaugesLayer = (): boolean =>
  readOverlay(GAUGES_PREF_KEY, MAP_OVERLAY_DEFAULTS.gauges);

export const setGaugesLayer = (on: boolean): boolean =>
  writePref(GAUGES_PREF_KEY, on ? "on" : "off");

const MGA_GRID_PREF_KEY = "mapMgaGrid";

/** The MGA grid overlay, off until the user switches it on. */
export const readMgaGridLayer = (): boolean =>
  readOverlay(MGA_GRID_PREF_KEY, MAP_OVERLAY_DEFAULTS.mgaGrid);

export const setMgaGridLayer = (on: boolean): boolean =>
  writePref(MGA_GRID_PREF_KEY, on ? "on" : "off");

/** False when the device refused to store it, so the caller can say so. */
export function setBasemapPreference(basemapId: BasemapId): boolean {
  return writePref(BASEMAP_PREF_KEY, basemapId);
}
