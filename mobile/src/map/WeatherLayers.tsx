import { memo, useMemo } from "react";
import { GeoJSONSource, Images, Layer } from "@maplibre/maplibre-react-native";
import {
  WIND_ARROW_IMAGE,
  WIND_ARROW_SDF_URI,
  type WeatherLayerKey,
  type WeatherWindFile,
  type WindBounds,
} from "@logjam/shared";

import { ResolvedSource } from "./ResolvedSource";
import type { ResolvedTileSource } from "./sourceResolver";
import {
  WEATHER_ARROW_STYLE,
  WEATHER_ARROWS_ID,
  WEATHER_WIND_SOURCE_ID,
  weatherArrowData,
  weatherFieldLayerId,
  weatherFieldPaint,
} from "./weatherLayers";

// An SDF, inlined, for the reasons at `ROUTE_ARROW_IMAGES` in MapScreen.tsx.
const WIND_ARROW_IMAGES = {
  [WIND_ARROW_IMAGE]: { source: { uri: WIND_ARROW_SDF_URI }, sdf: true },
};

/**
 * The Weather field and, for wind and gusts, its arrows. `beforeIds` is the
 * Terrain group's anchoring by layer id (MapScreen), which keeps both under the
 * map's roads and labels.
 */
export const WeatherLayers = memo(function WeatherLayers({
  source,
  layer,
  step,
  wind,
  arrows,
  view,
  beforeIds,
}: {
  source: Extract<ResolvedTileSource, { status: "ok" }>;
  layer: WeatherLayerKey;
  step: number;
  wind: WeatherWindFile | null;
  /** The layer draws arrows (wind and gusts). */
  arrows: boolean;
  /** The ground the map settled on, which the arrows are placed for. */
  view: { bounds: WindBounds; zoom: number } | null;
  beforeIds: Readonly<Record<string, string>>;
}) {
  const id = weatherFieldLayerId(source.key);
  const paint = useMemo(() => weatherFieldPaint(layer), [layer]);
  const data = useMemo(
    () => weatherArrowData(wind, step, view),
    [wind, step, view],
  );
  return (
    <>
      <ResolvedSource resolved={source}>
        <Layer
          key={id}
          type="color-relief"
          id={id}
          beforeId={beforeIds[id]}
          paint={paint as never}
        />
      </ResolvedSource>
      {arrows ? <Images images={WIND_ARROW_IMAGES} /> : null}
      {arrows ? (
        <GeoJSONSource id={WEATHER_WIND_SOURCE_ID} data={data}>
          <Layer
            key={WEATHER_ARROWS_ID}
            type="symbol"
            id={WEATHER_ARROWS_ID}
            beforeId={beforeIds[WEATHER_ARROWS_ID]}
            style={WEATHER_ARROW_STYLE}
          />
        </GeoJSONSource>
      ) : null}
    </>
  );
});
