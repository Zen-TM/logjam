import {
  type CarrierId,
  COVERAGE_HATCH_IMAGE,
  COVERAGE_MIN_ZOOM,
  coverageFilter,
  coverageOpacity,
  layerIn,
  type Region,
  zoomFadeIn,
} from "@logjam/shared";
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
} from "maplibre-gl";

import { coverageFillLayer } from "./layerOrder";

type Expr = ExpressionSpecification;

/**
 * The Coverage hatch of `region` over the source `source`, for `carrier`
 * alone, or null where the region has no coverage archive.
 */
export function coverageLayerSpec(
  region: Region,
  source: string,
  carrier: CarrierId,
): Extract<LayerSpecification, { type: "fill" }> | null {
  const coverage = layerIn(region, "coverage");
  if (!coverage) return null;
  return {
    id: coverageFillLayer(region),
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
