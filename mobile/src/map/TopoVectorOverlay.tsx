// Renders one vector topo overlay's layer stack (contours or OSM features)
// against a resolved PMTiles source — the mobile counterpart of the web's
// structural layer creation, driven entirely by buildTopoVectorLayerDefs.
import { memo, useMemo } from "react";
import {
  FillLayer,
  Images,
  LineLayer,
  SymbolLayer,
  type FillLayerStyle,
  type LineLayerStyle,
  type SymbolLayerStyle,
} from "@maplibre/maplibre-react-native";
import { OSM_POINT_ICON, type VectorStyleSettings } from "@logjam/shared";

import { buildTopoVectorLayerDefs, type TopoVectorLayerDef } from "./topoVectorLayers";

// Static require map — Metro needs literal require() calls per asset.
// Keys match the iconImage names emitted by buildTopoVectorLayerDefs.
export const TOPO_ICON_IMAGES: Record<string, ReturnType<typeof require>> = {
  "topo-icon-campsite": require("../../assets/topo-icons/campsite.png"),
  "topo-icon-peak": require("../../assets/topo-icons/peak.png"),
  "topo-icon-spring": require("../../assets/topo-icons/spring.png"),
  "topo-icon-gate": require("../../assets/topo-icons/gate.png"),
  "topo-icon-cave": require("../../assets/topo-icons/cave.png"),
  "topo-icon-ford": require("../../assets/topo-icons/ford.png"),
  "topo-icon-waterfall": require("../../assets/topo-icons/waterfall.png"),
  "topo-icon-trailhead": require("../../assets/topo-icons/trailhead.png"),
  "topo-icon-viewpoint": require("../../assets/topo-icons/viewpoint.png"),
  "topo-icon-hut": require("../../assets/topo-icons/hut.png"),
};

// One <Images> registration for every point icon — mount once per MapView.
export const TopoIconImages = memo(function TopoIconImages() {
  return <Images images={TOPO_ICON_IMAGES} />;
});

// Compile-time-ish guard: every OSM point icon key must have a require entry.
// (Fails loudly at module load in dev rather than rendering blank icons.)
for (const key of Object.keys(OSM_POINT_ICON)) {
  if (!TOPO_ICON_IMAGES[`topo-icon-${key}`]) {
    throw new Error(`Missing bundled topo icon for "${key}"`);
  }
}

function layerFor(
  def: TopoVectorLayerDef,
  idPrefix: string,
  sourceID: string,
  layerIndex: number,
) {
  const shared = {
    id: `${idPrefix}-${def.suffix}`,
    layerIndex,
    sourceID,
    sourceLayerID: def.sourceLayer,
    ...(def.filter && { filter: def.filter as never }),
    ...(def.minzoom !== undefined && { minZoomLevel: def.minzoom }),
  };
  switch (def.type) {
    case "line":
      return (
        <LineLayer key={shared.id} {...shared} style={def.style as LineLayerStyle} />
      );
    case "fill":
      return (
        <FillLayer key={shared.id} {...shared} style={def.style as FillLayerStyle} />
      );
    case "symbol":
      return (
        <SymbolLayer
          key={shared.id}
          {...shared}
          style={def.style as SymbolLayerStyle}
        />
      );
  }
}

/** Worst-case layer count for one vector overlay — used for index spacing. */
export const TOPO_VECTOR_MAX_LAYERS = 32;

export const TopoVectorOverlay = memo(function TopoVectorOverlay({
  kind,
  idPrefix,
  sourceID,
  startIndex,
  vectorStyle,
}: {
  kind: "contours" | "features";
  /** Unique per overlay — layer ids must not collide across jobs. */
  idPrefix: string;
  sourceID: string;
  startIndex: number;
  vectorStyle: VectorStyleSettings;
}) {
  const defs = useMemo(
    () => buildTopoVectorLayerDefs(kind, vectorStyle),
    [kind, vectorStyle],
  );
  return (
    <>{defs.map((def, i) => layerFor(def, idPrefix, sourceID, startIndex + i))}</>
  );
});
