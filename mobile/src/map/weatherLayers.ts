// The Weather overlay as MapScreen mounts it: one `color-relief` field read
// from a terrarium archive (ADR 0048, drawn as the slope is), and for wind and
// gusts arrows over it. Shared weatherMap.ts holds the colours, the files and
// the arrows' rotation.
import {
  MAP_INK,
  ROUTE_ARROW_IMAGE,
  WEATHER_MAP,
  weatherLayerUrl,
  weatherReliefColor,
  windArrows,
  type WeatherLayerKey,
  type WeatherMapFile,
  type WeatherWindFile,
} from "@logjam/shared";
import type { SymbolLayerStyle } from "@maplibre/maplibre-react-native";

import { hashKey, type ResolvedTileSource } from "./sourceResolver";

export const WEATHER_ARROWS_ID = "weather-arrows";
export const WEATHER_WIND_SOURCE_ID = "weather-wind";

export function weatherFieldLayerId(sourceKey: string): string {
  return `weather-field-${sourceKey}`;
}

/**
 * The archive for a layer at a step as a source the resolver's consumers draw,
 * or null for a total the run does not have. A new step or layer is a new URL
 * and so a new key: the source remounts (layer ids carry the key).
 * `base` is where the run's files are: the CDN, or the kept copy on the phone.
 * Guard: weatherLayers.test.ts.
 */
export function weatherSource(
  base: string,
  file: WeatherMapFile,
  layer: WeatherLayerKey,
  step: number,
): Extract<ResolvedTileSource, { status: "ok" }> | null {
  const archive = weatherLayerUrl(base, file, layer, step);
  if (!archive) return null;
  const url = `pmtiles://${archive}`;
  return {
    status: "ok",
    key: `${WEATHER_MAP.id}:${hashKey(url)}`,
    sourceType: "raster-dem",
    url,
    attribution: WEATHER_MAP.credit,
    origin: archive.startsWith("file:") ? "local" : "remote",
  };
}

/**
 * The opacity is in the colour stops (light rain stays light), so the layer
 * itself is opaque.
 */
export function weatherFieldPaint(layer: WeatherLayerKey) {
  return {
    "color-relief-opacity": 1,
    "color-relief-color": weatherReliefColor(layer),
  };
}

/**
 * The arrowhead (an SDF the screen registers for routes) turned to where the
 * wind blows by each feature's `rotate`. Overlap is off so MapLibre thins
 * the arrows itself as the map zooms out; the size grows a little with the
 * speed. Dark with a light halo so they read over every field colour.
 * Guard: weatherLayers.test.ts.
 */
export const WEATHER_ARROW_STYLE: SymbolLayerStyle = {
  iconImage: ROUTE_ARROW_IMAGE,
  iconRotate: ["get", "rotate"],
  iconRotationAlignment: "map",
  iconPitchAlignment: "map",
  iconAllowOverlap: false,
  iconIgnorePlacement: false,
  iconSize: ["interpolate", ["linear"], ["get", "speed"], 0, 0.25, 60, 0.5],
  iconColor: MAP_INK.casing,
  iconHaloColor: MAP_INK.ring,
  iconHaloWidth: 1.5,
};

/** The arrows of one step, or an empty collection when there is no wind file. */
export function weatherArrowData(
  wind: WeatherWindFile | null,
  step: number,
): ReturnType<typeof windArrows> {
  return wind
    ? windArrows(wind, step)
    : { type: "FeatureCollection", features: [] };
}
