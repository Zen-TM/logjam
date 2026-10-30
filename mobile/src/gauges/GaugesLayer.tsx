// The river gauge dots: one colour for every gauge, because a dot says where a
// gauge is, never what it read. A gauge with no recent reading is only fainter.
import { memo, useMemo } from "react";
import type { NativeSyntheticEvent } from "react-native";
import {
  GeoJSONSource,
  Layer,
  type PressEventWithFeatures,
} from "@maplibre/maplibre-react-native";
import {
  latestGaugeReading,
  MAP_INK,
  type GaugeLatestFile,
} from "@logjam/shared";

import { PIN_FLOOR } from "../map/layerOrder";

const FAINT = 0.35;
const RECENT = ["case", ["get", "recent"], 1, FAINT] as unknown as number;

export const GaugesLayer = memo(function GaugesLayer({
  file,
  onPress,
}: {
  file: GaugeLatestFile;
  onPress: (event: NativeSyntheticEvent<PressEventWithFeatures>) => void;
}) {
  const data = useMemo(() => {
    const now = Date.now();
    return {
      type: "FeatureCollection" as const,
      features: file.gauges.map((g) => ({
        type: "Feature" as const,
        id: g.id,
        geometry: {
          type: "Point" as const,
          coordinates: [g.lon, g.lat] as [number, number],
        },
        properties: { id: g.id, recent: latestGaugeReading(g, now) !== null },
      })),
    };
  }, [file]);
  return (
    <GeoJSONSource id="gauges" data={data} onPress={onPress}>
      <Layer
        key="gauge-circles"
        type="circle"
        id="gauge-circles"
        beforeId={PIN_FLOOR}
        style={{
          circleRadius: 6,
          circleColor: MAP_INK.gauge,
          circleOpacity: RECENT,
          circleStrokeColor: MAP_INK.ring,
          circleStrokeWidth: 1.5,
          circleStrokeOpacity: RECENT,
        }}
      />
    </GeoJSONSource>
  );
});
