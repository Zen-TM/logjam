// The river gauge drops: one colour for every gauge, because a drop says where
// a gauge is, never what it read. A gauge with no recent reading is only fainter.
import { memo, useMemo } from "react";
import type { NativeSyntheticEvent } from "react-native";
import {
  GeoJSONSource,
  Images,
  Layer,
  type PressEventWithFeatures,
} from "@maplibre/maplibre-react-native";
import {
  GAUGE_ICON_IMAGE,
  GAUGE_ICON_SDF_URI,
  GAUGE_ICON_SIZE,
  gaugeDisplayName,
  latestGaugeReading,
  MAP_INK,
  MAP_LABEL_MIN_ZOOM,
  type GaugeLatestFile,
} from "@logjam/shared";

import { PIN_FLOOR } from "../map/layerOrder";
import { PIN_LABEL_TEXT } from "../map/mapLabelText";

const FAINT = 0.35;
const RECENT = ["case", ["get", "recent"], 1, FAINT] as unknown as number;
// An SDF, inlined, for the reasons at `ROUTE_ARROW_IMAGES` in MapScreen.tsx.
const GAUGE_IMAGES = {
  [GAUGE_ICON_IMAGE]: { source: { uri: GAUGE_ICON_SDF_URI }, sdf: true },
};

export const GaugesLayer = memo(function GaugesLayer({
  file,
  now,
  onPress,
}: {
  file: GaugeLatestFile;
  now: number;
  onPress: (event: NativeSyntheticEvent<PressEventWithFeatures>) => void;
}) {
  const data = useMemo(() => {
    return {
      type: "FeatureCollection" as const,
      features: file.gauges.map((g) => ({
        type: "Feature" as const,
        id: g.id,
        geometry: {
          type: "Point" as const,
          coordinates: [g.lon, g.lat] as [number, number],
        },
        properties: {
          id: g.id,
          name: gaugeDisplayName(g.name),
          recent: latestGaugeReading(g, now) !== null,
        },
      })),
    };
  }, [file, now]);
  return (
    <>
      <Images images={GAUGE_IMAGES} />
      <GeoJSONSource id="gauges" data={data} onPress={onPress}>
        <Layer
          key="gauge-drops"
          type="symbol"
          id="gauge-drops"
          beforeId={PIN_FLOOR}
          style={{
            iconImage: GAUGE_ICON_IMAGE,
            iconSize: GAUGE_ICON_SIZE,
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            iconColor: MAP_INK.gauge,
            iconOpacity: RECENT,
            iconHaloColor: MAP_INK.ring,
            iconHaloWidth: 1.5,
          }}
        />
        {/* Under the pins, so a place's own name wins any collision. */}
        <Layer
          key="gauge-labels"
          type="symbol"
          id="gauge-labels"
          beforeId={PIN_FLOOR}
          minzoom={MAP_LABEL_MIN_ZOOM}
          style={{
            textField: ["get", "name"] as unknown as string,
            ...PIN_LABEL_TEXT,
            textMaxWidth: 10,
            textColor: MAP_INK.label,
            textHaloColor: MAP_INK.casing,
            textHaloWidth: 1,
            textAnchor: "top",
            textOffset: [0, 1.2],
          }}
        />
      </GeoJSONSource>
    </>
  );
});
