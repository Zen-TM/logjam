// Mounts the generated Protomaps basemap layer set as MLRN components
// (map-sources.md spike S6 / stage4a §8.1): the shell style stays empty, the
// resolver supplies the source, and these layers bind to it declaratively.
//
// The generated set's `background` layer mounts at the bottom of the band
// (land colour under the tiles), above the shell's own background at index 0,
// and unmounts cleanly with the rest on basemap swap.
import { memo } from "react";
import { Layer, type LayerProps } from "@maplibre/maplibre-react-native";

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
  idPrefix: string,
) {
  const id = `${idPrefix}-${def.id}`;
  // One cast for the whole prop bag. The generated defs carry a merged
  // camelCase style object rather than the spec's paint/layout split, so they
  // go in through MLRN's legacy `style` prop — a different arm of LayerProps
  // than the spec-shaped one, which is why the bag can't be typed piecewise.
  // The generator (scripts/basemap/generate-style.mjs) and this call have to
  // move together when that prop goes in MLRN v12. The filter is `as never`
  // for the same reason it always was: FilterSpecification is a stricter tuple
  // type than the generated JSON can express, and the values come straight
  // from @protomaps/basemaps.
  const props = {
    id,
    layerIndex,
    type: def.type,
    style: def.style,
    // A background layer has no source; everything else binds to the one the
    // resolver mounted.
    ...(def.type === "background"
      ? {}
      : { source: sourceID, "source-layer": def.sourceLayer }),
    ...(def.filter && { filter: def.filter }),
    ...(def.minzoom !== undefined && { minzoom: def.minzoom }),
    ...(def.maxzoom !== undefined && { maxzoom: def.maxzoom }),
  } as LayerProps;
  return <Layer key={id} {...props} />;
}

/**
 * The full basemap layer stack for one flavor, bound to `sourceID` and pinned
 * at layerIndex `startIndex..startIndex+count-1` (keeps the basemap band
 * below topo overlays and canyon layers across source remounts).
 */
// MEMOISED, and it matters more here than anywhere else on the map: MLRN
// memoises none of its layer components, and each one re-runs `transformStyle`
// and re-commits props to the native layer on every render it sees. This stack
// is ~71 layers wide (and mounts once PER downloaded region offline), sitting
// inside a screen that re-renders on every camera settle, every fix and every
// state flip. Its props are primitives, so the memo actually holds.
export const ProtomapsLayers = memo(function ProtomapsLayers({
  flavor,
  sourceID,
  startIndex,
}: {
  flavor: ProtomapsFlavor;
  sourceID: string;
  startIndex: number;
}) {
  // Layer ids must be unique across the whole map, and offline this component
  // mounts ONCE PER DOWNLOADED REGION — every stack emitting the same fixed
  // `pm-background`, `pm-water`, … meant the second saved vector region
  // collided with the first and never drew. The source id is already unique
  // per region, so it seeds the prefix.
  const idPrefix = `pm-${sourceID}`;
  return (
    <>
      {protomapsLayerDefs(flavor).map((def, i) =>
        layerComponent(def, sourceID, startIndex + i, idPrefix),
      )}
    </>
  );
});
