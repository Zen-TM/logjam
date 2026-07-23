// Mounts the generated Protomaps basemap layer set as MLRN components
// (map-sources.md spike S6 / stage4a §8.1): the shell style stays empty, the
// resolver supplies the source, and these layers bind to it declaratively.
//
// The generated set's `background` layer mounts at the bottom of the band
// (land colour under the tiles), above the shell's own background at index 0,
// and unmounts cleanly with the rest on basemap swap.
import {
  BackgroundLayer,
  FillLayer,
  LineLayer,
  SymbolLayer,
  type BackgroundLayerStyle,
  type FillLayerStyle,
  type LineLayerStyle,
  type SymbolLayerStyle,
} from "@maplibre/maplibre-react-native";

import {
  protomapsLayerDefs,
  type ProtomapsFlavor,
  type ProtomapsLayerDef,
} from "./protomapsLayers";

/** Number of style layers mounted for a flavor — callers stack above this. */
export function protomapsLayerCount(flavor: ProtomapsFlavor): number {
  return protomapsLayerDefs(flavor).length;
}

function layerComponent(
  def: ProtomapsLayerDef,
  sourceID: string,
  layerIndex: number,
) {
  const shared = {
    id: `pm-${def.id}`,
    layerIndex,
    ...(def.sourceLayer && { sourceLayerID: def.sourceLayer }),
    // MLRN's FilterExpression is a stricter tuple type than the generated
    // JSON can express; values come straight from @protomaps/basemaps.
    ...(def.filter && { filter: def.filter as never }),
    ...(def.minzoom !== undefined && { minZoomLevel: def.minzoom }),
    ...(def.maxzoom !== undefined && { maxZoomLevel: def.maxzoom }),
  };
  switch (def.type) {
    case "background":
      // Backgrounds have no source; give it the flavor colour at the bottom
      // of the protomaps band.
      return (
        <BackgroundLayer
          key={shared.id}
          {...shared}
          style={def.style as BackgroundLayerStyle}
        />
      );
    case "fill":
      return (
        <FillLayer
          key={shared.id}
          {...shared}
          sourceID={sourceID}
          style={def.style as FillLayerStyle}
        />
      );
    case "line":
      return (
        <LineLayer
          key={shared.id}
          {...shared}
          sourceID={sourceID}
          style={def.style as LineLayerStyle}
        />
      );
    case "symbol":
      return (
        <SymbolLayer
          key={shared.id}
          {...shared}
          sourceID={sourceID}
          style={def.style as SymbolLayerStyle}
        />
      );
  }
}

/**
 * The full basemap layer stack for one flavor, bound to `sourceID` and pinned
 * at layerIndex `startIndex..startIndex+count-1` (keeps the basemap band
 * below topo overlays and canyon layers across source remounts).
 */
export function ProtomapsLayers({
  flavor,
  sourceID,
  startIndex,
}: {
  flavor: ProtomapsFlavor;
  sourceID: string;
  startIndex: number;
}) {
  return (
    <>
      {protomapsLayerDefs(flavor).map((def, i) =>
        layerComponent(def, sourceID, startIndex + i),
      )}
    </>
  );
}
