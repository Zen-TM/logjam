import {
  type CarrierId,
  COVERAGE_HATCH_IMAGE,
  COVERAGE_MIN_ZOOM,
  type CoverageArchive,
  coverageFilter,
  coverageOpacity,
  zoomFadeIn,
} from "@logjam/shared";
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
} from "maplibre-gl";

import { COVERAGE_FILL_LAYER } from "./layerOrder";

type Expr = ExpressionSpecification;

/** The Coverage hatch over the source `source` of `coverage`, for `carrier` alone. */
export function coverageLayerSpec(
  coverage: CoverageArchive,
  source: string,
  carrier: CarrierId,
): Extract<LayerSpecification, { type: "fill" }> {
  return {
    id: COVERAGE_FILL_LAYER,
    type: "fill",
    source,
    "source-layer": coverage.sourceLayer,
    minzoom: COVERAGE_MIN_ZOOM,
    filter: coverageFilter(coverage, carrier) as FilterSpecification,
    paint: {
      "fill-pattern": COVERAGE_HATCH_IMAGE,
      "fill-opacity": zoomFadeIn(
        COVERAGE_MIN_ZOOM,
        coverageOpacity(coverage),
      ) as Expr,
    },
  };
}
