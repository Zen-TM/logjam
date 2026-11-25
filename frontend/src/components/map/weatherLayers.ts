import {
  MAP_INK,
  WEATHER_CREDIT_URL,
  WEATHER_MAP,
  weatherReliefColor,
  type WeatherLayerKey,
  type WeatherWindFile,
  WIND_ARROW_IMAGE,
  windArrowsIn,
} from "@logjam/shared";
import type {
  ExpressionSpecification,
  GeoJSONSourceSpecification,
  LayerSpecification,
} from "maplibre-gl";

import { WEATHER_ARROWS_LAYER, WEATHER_FIELD_LAYER } from "./layerOrder";

/** Not `topo-src-…`: the topo effect removes those that no entry owns, and
 *  the arrows come and go with the layer picked, not with the entry. */
export const WEATHER_WIND_SOURCE = "weather-wind";

/** The credit as the map's attribution: drawn only while the field is. */
export const WEATHER_CREDIT_HTML = `<a href="${WEATHER_CREDIT_URL}">${WEATHER_MAP.credit}</a>`;

/** The colour field over the raster-dem source `source`, for `key`. The
 *  stops carry their own alpha, so the layer is opaque. */
export function weatherFieldLayerSpec(
  source: string,
  key: WeatherLayerKey,
): Extract<LayerSpecification, { type: "color-relief" }> {
  return {
    id: WEATHER_FIELD_LAYER,
    type: "color-relief",
    source,
    paint: {
      "color-relief-opacity": 1,
      "color-relief-color": weatherReliefColor(key) as ExpressionSpecification,
    },
  };
}

/** The wind arrow, longer the harder the wind blows, on the grid
 *  `windArrowsIn` spaces by zoom. They overlap anything and block nothing: the
 *  lattice spaces them, and a label stays where it was. */
export function windArrowsLayerSpec(
  source: string,
): Extract<LayerSpecification, { type: "symbol" }> {
  return {
    id: WEATHER_ARROWS_LAYER,
    type: "symbol",
    source,
    layout: {
      "icon-image": WIND_ARROW_IMAGE,
      "icon-rotate": ["get", "rotate"],
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-size": [
        "interpolate",
        ["linear"],
        ["get", "speed"],
        0,
        0.4,
        60,
        0.75,
      ],
    },
    paint: {
      "icon-color": MAP_INK.casing,
      "icon-halo-color": MAP_INK.ring,
      "icon-halo-width": 1,
      "icon-halo-blur": 0.5,
    },
  };
}

type ArrowsMap = {
  getSource(id: string): unknown;
  addSource(id: string, spec: GeoJSONSourceSpecification): unknown;
  removeSource(id: string): unknown;
  getLayer(id: string): unknown;
  addLayer(spec: LayerSpecification, beforeId?: string): unknown;
  moveLayer(id: string, beforeId?: string): unknown;
  removeLayer(id: string): unknown;
  getStyle(): { layers: { id: string }[] };
};

/**
 * Puts the wind arrows `data` on the map directly over the colour field, or
 * takes them off for null. A no-op while the field is not on the map. The
 * field is rebuilt (on top of the style) when the layer picked changes, so an
 * arrows layer that already exists is moved back over it.
 */
export function syncWindArrows(
  map: ArrowsMap,
  data: GeoJSONSourceSpecification["data"] | null,
): void {
  const source = map.getSource(WEATHER_WIND_SOURCE) as
    | { setData(data: unknown): void }
    | undefined;
  if (!data || !map.getLayer(WEATHER_FIELD_LAYER)) {
    if (map.getLayer(WEATHER_ARROWS_LAYER))
      map.removeLayer(WEATHER_ARROWS_LAYER);
    if (source) map.removeSource(WEATHER_WIND_SOURCE);
    return;
  }
  if (source) source.setData(data);
  else map.addSource(WEATHER_WIND_SOURCE, { type: "geojson", data });
  const ids = map.getStyle().layers.map((l) => l.id);
  const placed = ids.indexOf(WEATHER_ARROWS_LAYER) >= 0;
  const rest = ids.filter((id) => id !== WEATHER_ARROWS_LAYER);
  const above = rest[rest.indexOf(WEATHER_FIELD_LAYER) + 1];
  if (!placed) map.addLayer(windArrowsLayerSpec(WEATHER_WIND_SOURCE), above);
  else if (ids[ids.indexOf(WEATHER_FIELD_LAYER) + 1] !== WEATHER_ARROWS_LAYER)
    map.moveLayer(WEATHER_ARROWS_LAYER, above);
}

/**
 * `syncWindArrows` with the arrows `wind` has for the view the map is in now:
 * placed on its lattice at this zoom, so the map calls it when a move ends.
 */
export function placeWindArrows(
  map: ArrowsMap & {
    getBounds(): {
      getWest(): number;
      getSouth(): number;
      getEast(): number;
      getNorth(): number;
    };
    getZoom(): number;
  },
  wind: { data: WeatherWindFile; step: number } | null,
): void {
  const b = map.getBounds();
  syncWindArrows(
    map,
    wind
      ? windArrowsIn(
          wind.data,
          wind.step,
          {
            west: b.getWest(),
            south: b.getSouth(),
            east: b.getEast(),
            north: b.getNorth(),
          },
          map.getZoom(),
        )
      : null,
  );
}
