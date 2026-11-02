// The MGA grid for the view that last settled (shared mgaGrid), under the pins.
import { memo, useMemo } from "react";
import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import {
  MAP_INK,
  MGA_GRID_STYLE,
  mgaGrid,
  type GridBbox,
} from "@logjam/shared";

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
      <GeoJSONSource id="mga-grid" data={grid}>
        <Layer
          key={GRID_LINES}
          type="line"
          id={GRID_LINES}
          beforeId={PIN_FLOOR}
          style={{
            lineColor: MAP_INK.grid,
            lineWidth: MGA_GRID_STYLE.lineWidth,
            lineOpacity: MGA_GRID_STYLE.lineOpacity,
          }}
        />
        <Layer
          key={GRID_LABELS}
          type="symbol"
          id={GRID_LABELS}
          beforeId={PIN_FLOOR}
          style={{
            symbolPlacement: "line",
            symbolSpacing: MGA_GRID_STYLE.labelSpacing,
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
