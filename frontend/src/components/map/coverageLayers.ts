import {
  type CarrierId,
  coverageFilter,
  coverageOpacity,
  coveragePattern,
  NSW_COVERAGE,
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
    minzoom: NSW_COVERAGE.minzoom,
    filter: coverageFilter(carrier) as FilterSpecification,
    paint: {
      "fill-pattern": coveragePattern() as Expr,
      "fill-opacity": coverageOpacity() as Expr,
    },
  };
}
