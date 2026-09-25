// Renders one vector topo overlay's layer stack (contours or OSM features)
// against a resolved PMTiles source — the mobile counterpart of the web's
// structural layer creation, driven entirely by buildTopoVectorLayerDefs.
import { memo, useMemo } from "react";
import { Images, Layer, type LayerProps } from "@maplibre/maplibre-react-native";
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

// One <Images> registration for every point icon — mount once per Map.
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
  const id = `${idPrefix}-${def.suffix}`;
  // One cast for the whole prop bag: buildTopoVectorLayerDefs emits one merged
  // camelCase style object (web parity), not the spec's paint/layout split, so
  // it goes in through MLRN's legacy `style` prop — which types as a different
  // arm of LayerProps than the spec-shaped one. See ProtomapsLayers for the
  // v12 note.
  const props = {
    id,
    layerIndex,
    source: sourceID,
    "source-layer": def.sourceLayer,
    type: def.type,
    style: def.style,
    ...(def.filter && { filter: def.filter }),
    ...(def.minzoom !== undefined && { minzoom: def.minzoom }),
  } as LayerProps;
  return <Layer key={id} {...props} />;
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
