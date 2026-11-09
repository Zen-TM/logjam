import {
  FIRE_MIN_ZOOM,
  fireColor,
  fireEdgeOpacity,
  fireFillOpacity,
  NSW_FIRE,
  zoomFadeIn,
} from "@logjam/shared";
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";

import { FIRE_EDGE_LAYER, FIRE_FILL_LAYER } from "./layerOrder";

type Expr = ExpressionSpecification;

/**
 * The Fire history layers over the source `source`, tint first and its edge
 * over it, as of `now`: the ramp's months are counted from it.
 */
export function fireLayerSpecs(
  source: string,
  now: Date,
): [
  Extract<LayerSpecification, { type: "fill" }>,
  Extract<LayerSpecification, { type: "line" }>,
] {
  const common = {
    source,
    "source-layer": NSW_FIRE.sourceLayer,
    minzoom: FIRE_MIN_ZOOM,
  };
  return [
    {
      ...common,
      id: FIRE_FILL_LAYER,
      type: "fill",
      paint: {
        "fill-color": fireColor(now) as Expr,
        "fill-opacity": zoomFadeIn(FIRE_MIN_ZOOM, fireFillOpacity(now)) as Expr,
      },
    },
    {
      ...common,
      id: FIRE_EDGE_LAYER,
      type: "line",
      paint: {
        "line-color": fireColor(now) as Expr,
        "line-width": 1,
        "line-opacity": zoomFadeIn(FIRE_MIN_ZOOM, fireEdgeOpacity(now)) as Expr,
      },
    },
  ];
}
