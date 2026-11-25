import {
  type CarrierId,
  COVERAGE_HATCH_IMAGE,
  COVERAGE_MIN_ZOOM,
  coverageFilter,
  coverageOpacity,
  NSW_COVERAGE,
  zoomFadeIn,
} from "@logjam/shared";
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
} from "maplibre-gl";

import { COVERAGE_FILL_LAYER } from "./layerOrder";

type Expr = ExpressionSpecification;

/** The Coverage hatch over the source `source`, for `carrier` alone. */
export function coverageLayerSpec(
  source: string,
  carrier: CarrierId,
): Extract<LayerSpecification, { type: "fill" }> {
  return {
    id: COVERAGE_FILL_LAYER,
    type: "fill",
    source,
    "source-layer": NSW_COVERAGE.sourceLayer,
    minzoom: COVERAGE_MIN_ZOOM,
    filter: coverageFilter(carrier) as FilterSpecification,
    paint: {
      "fill-pattern": COVERAGE_HATCH_IMAGE,
      "fill-opacity": zoomFadeIn(COVERAGE_MIN_ZOOM, coverageOpacity()) as Expr,
    },
  };
}
