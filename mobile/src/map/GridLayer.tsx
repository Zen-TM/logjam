// The map grid for the view that last settled (shared mapGrid), under the pins.
import { memo, useMemo } from "react";
import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import { MAP_INK, GRID_STYLE, mapGrid, type GridBbox } from "@logjam/shared";

import { GRID_LABELS, GRID_LINES, PIN_FLOOR } from "./layerOrder";
import { PIN_LABEL_TEXT } from "./mapLabelText";

export const GridLayer = memo(function GridLayer({
  bbox,
  zoom,
}: {
  bbox: GridBbox;
  zoom: number;
}) {
  const grid = useMemo(() => mapGrid(bbox, zoom), [bbox, zoom]);
  return (
    <>
      <GeoJSONSource id="mga-grid" data={grid}>
        <Layer
          key={GRID_LINES}
          type="line"
          id={GRID_LINES}
          beforeId={PIN_FLOOR}
          style={{
            lineColor: MAP_INK.grid,
            lineWidth: GRID_STYLE.lineWidth,
            lineOpacity: GRID_STYLE.lineOpacity,
          }}
        />
        <Layer
          key={GRID_LABELS}
          type="symbol"
          id={GRID_LABELS}
          beforeId={PIN_FLOOR}
          style={{
            symbolPlacement: "line",
            symbolSpacing: GRID_STYLE.labelSpacing,
            textRotationAlignment: "viewport",
            textField: ["get", "text"] as unknown as string,
            ...PIN_LABEL_TEXT,
            textColor: MAP_INK.label,
            textHaloColor: MAP_INK.casing,
            textHaloWidth: 1.5,
          }}
        />
      </GeoJSONSource>
    </>
  );
});
