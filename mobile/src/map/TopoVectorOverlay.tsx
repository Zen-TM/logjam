// Renders the statewide contours' layer stack against a resolved PMTiles
// source — the Logjam GPS counterpart of Logjam Web's structural layer
// creation, driven entirely by buildTopoVectorLayerDefs.
import { memo, useMemo } from "react";
import { Layer, type LayerProps } from "@maplibre/maplibre-react-native";
import type { VectorStyleSettings } from "@logjam/shared";

import {
  buildTopoVectorLayerDefs,
  type TopoVectorLayerDef,
} from "./topoVectorLayers";

function layerFor(
  def: TopoVectorLayerDef,
  idPrefix: string,
  sourceID: string,
  beforeId: string,
  zooms: { minzoom?: number; maxzoom?: number },
) {
  const id = `${idPrefix}-${def.suffix}`;
  const minzoom =
    def.minzoom === undefined || zooms.minzoom === undefined
      ? (def.minzoom ?? zooms.minzoom)
      : Math.max(def.minzoom, zooms.minzoom);
  // One cast for the whole prop bag: buildTopoVectorLayerDefs emits one merged
  // camelCase style object (parity with Logjam Web), not the spec's
  // paint/layout split, so it goes in through MLRN's legacy `style` prop —
  // which types as a different arm of LayerProps than the spec-shaped one.
  // See ProtomapsLayers for the v12 note.
  const props = {
    id,
    beforeId,
    source: sourceID,
    "source-layer": def.sourceLayer,
    type: def.type,
    style: def.style,
    ...(def.filter && { filter: def.filter }),
    ...(minzoom !== undefined && { minzoom }),
    ...(zooms.maxzoom !== undefined && { maxzoom: zooms.maxzoom }),
  } as LayerProps;
  return <Layer key={id} {...props} />;
}

/** The id each of an overlay's layers mounts under, bottom to top. */
export function topoVectorLayerIds(
  idPrefix: string,
  vectorStyle: VectorStyleSettings,
): string[] {
  return buildTopoVectorLayerDefs(vectorStyle).map(
    (def) => `${idPrefix}-${def.suffix}`,
  );
}

export const TopoVectorOverlay = memo(function TopoVectorOverlay({
  idPrefix,
  sourceID,
  beforeIds,
  vectorStyle,
  minzoom,
  maxzoom,
}: {
  /** Unique per overlay — layer ids must not collide across jobs. */
  idPrefix: string;
  sourceID: string;
  /** `chainBeforeIds` entries for this overlay's `topoVectorLayerIds`. */
  beforeIds: Record<string, string>;
  vectorStyle: VectorStyleSettings;
  /** The zooms the stack draws at, where it doesn't draw at every zoom. */
  minzoom?: number;
  maxzoom?: number;
}) {
  const defs = useMemo(
    () => buildTopoVectorLayerDefs(vectorStyle),
    [vectorStyle],
  );
  return (
    <>
      {defs.map((def) =>
        layerFor(
          def,
          idPrefix,
          sourceID,
          beforeIds[`${idPrefix}-${def.suffix}`],
          { minzoom, maxzoom },
        ),
      )}
    </>
  );
});
