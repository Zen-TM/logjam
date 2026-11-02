// The MGA grid for the view that last settled (shared mgaGrid), under the pins.
import { memo, useMemo } from "react";
import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import { MAP_INK, mgaGrid, type GridBbox } from "@logjam/shared";

import { GRID_LABELS, GRID_LINES, PIN_FLOOR } from "./layerOrder";
import { PIN_LABEL_TEXT } from "./mapLabelText";

export const MgaGridLayer = memo(function MgaGridLayer({
  bbox,
  zoom,
}: {
  bbox: GridBbox;
  zoom: number;
}) {
  const grid = useMemo(() => mgaGrid(bbox, zoom), [bbox, zoom]);
  return (
    <>
      <GeoJSONSource id={GRID_LINES} data={grid.lines}>
        <Layer
          key={GRID_LINES}
          type="line"
          id={GRID_LINES}
          beforeId={PIN_FLOOR}
          style={{
            lineColor: MAP_INK.grid,
            lineWidth: 0.75,
            lineOpacity: 0.8,
          }}
        />
      </GeoJSONSource>
      <GeoJSONSource id={GRID_LABELS} data={grid.labels}>
        <Layer
          key={GRID_LABELS}
          type="symbol"
          id={GRID_LABELS}
          beforeId={PIN_FLOOR}
          style={{
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
