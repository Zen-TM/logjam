import { memo, useMemo } from "react";
import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import type { WeatherLayerKey, WeatherWindFile } from "@logjam/shared";

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
  beforeIds,
}: {
  source: Extract<ResolvedTileSource, { status: "ok" }>;
  layer: WeatherLayerKey;
  step: number;
  wind: WeatherWindFile | null;
  /** The layer draws arrows (wind and gusts). */
  arrows: boolean;
  beforeIds: Readonly<Record<string, string>>;
}) {
  const id = weatherFieldLayerId(source.key);
  const paint = useMemo(() => weatherFieldPaint(layer), [layer]);
  const data = useMemo(() => weatherArrowData(wind, step), [wind, step]);
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
