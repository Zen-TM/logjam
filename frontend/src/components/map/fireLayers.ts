import {
  FIRE_MIN_ZOOM,
  fireColor,
  fireEdgeOpacity,
  fireFillOpacity,
  layerIn,
  type Region,
  zoomFadeIn,
} from "@logjam/shared";
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";

import { fireEdgeLayer, fireFillLayer } from "./layerOrder";

type Expr = ExpressionSpecification;

/**
 * The Fire history layers of `region` over the source `source`, tint first and
 * its edge over it, as of `now`: the ramp's months are counted from it. Null
 * where the region has no fire archive.
 */
export function fireLayerSpecs(
  region: Region,
  source: string,
  now: Date,
):
  | [
      Extract<LayerSpecification, { type: "fill" }>,
      Extract<LayerSpecification, { type: "line" }>,
    ]
  | null {
  const fire = layerIn(region, "fire");
  if (!fire) return null;
  const common = {
    source,
    "source-layer": fire.sourceLayer,
    minzoom: FIRE_MIN_ZOOM,
  };
  return [
    {
      ...common,
      id: fireFillLayer(region),
      type: "fill",
      paint: {
        "fill-color": fireColor(fire, now) as Expr,
        "fill-opacity": zoomFadeIn(
          FIRE_MIN_ZOOM,
          fireFillOpacity(fire, now),
        ) as Expr,
      },
    },
    {
      ...common,
      id: fireEdgeLayer(region),
      type: "line",
      paint: {
        "line-color": fireColor(fire, now) as Expr,
        "line-width": 1,
        "line-opacity": zoomFadeIn(
          FIRE_MIN_ZOOM,
          fireEdgeOpacity(fire, now),
        ) as Expr,
      },
    },
  ];
}
