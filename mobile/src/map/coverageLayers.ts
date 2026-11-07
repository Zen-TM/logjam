// The Coverage overlay as MapScreen mounts it: one hatched fill, with the
// hatch images registered beside it (shared nswCoverage.ts holds the levels).
import {
  type CarrierId,
  COVERAGE_HATCH_PIXEL_RATIO,
  COVERAGE_HATCH_URIS,
  coverageFilter,
  coverageOpacity,
  coveragePattern,
  NSW_COVERAGE,
} from "@logjam/shared";
import type { FillLayerSpecification } from "@maplibre/maplibre-react-native";

type FillPaint = NonNullable<FillLayerSpecification["paint"]>;

export function coverageLayerId(sourceKey: string): string {
  return `nsw-coverage-${sourceKey}`;
}

/**
 * For `<Images images>`: each hatch under the name the pattern expression
 * uses, at the pixel ratio it is drawn at, so it is as fine as Logjam Web's.
 */
export const COVERAGE_IMAGES = Object.fromEntries(
  Object.entries(COVERAGE_HATCH_URIS).map(([name, uri]) => [
    name,
    { source: { uri, scale: COVERAGE_HATCH_PIXEL_RATIO } },
  ]),
);

export function coverageLayerFilter(
  carrier: CarrierId,
): FillLayerSpecification["filter"] {
  return coverageFilter(carrier) as FillLayerSpecification["filter"];
}

export function coverageLayerPaint(): FillPaint {
  return {
    "fill-pattern": coveragePattern() as FillPaint["fill-pattern"],
    "fill-opacity": coverageOpacity() as FillPaint["fill-opacity"],
  };
}

/** A clip may hold fewer zooms than the archive; never draw below its own. */
export function coverageMinZoom(layerMinZoom: number | undefined): number {
  return Math.max(layerMinZoom ?? 0, NSW_COVERAGE.minzoom);
}
