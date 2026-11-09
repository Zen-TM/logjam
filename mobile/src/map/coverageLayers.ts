// The Coverage overlay as MapScreen mounts it: one hatched fill, with the
// hatch image registered beside it (shared nswCoverage.ts holds the levels).
import {
  type CarrierId,
  COVERAGE_HATCH_IMAGE,
  COVERAGE_HATCH_PIXEL_RATIO,
  COVERAGE_HATCH_URIS,
  COVERAGE_MIN_ZOOM,
  coverageFilter,
  coverageOpacity,
  zoomFadeIn,
} from "@logjam/shared";
import type { FillLayerSpecification } from "@maplibre/maplibre-react-native";

type FillPaint = NonNullable<FillLayerSpecification["paint"]>;

export function coverageLayerId(sourceKey: string): string {
  return `nsw-coverage-${sourceKey}`;
}

/**
 * For `<Images images>`: the hatch under the name the paint uses, at the pixel
 * ratio it is drawn at, so it is as fine as Logjam Web's.
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
    "fill-pattern": COVERAGE_HATCH_IMAGE,
    "fill-opacity": zoomFadeIn(
      COVERAGE_MIN_ZOOM,
      coverageOpacity(),
    ) as FillPaint["fill-opacity"],
  };
}

/** Drawn from `COVERAGE_MIN_ZOOM`, or a clip's own first zoom if that is deeper. */
export function coverageMinZoom(layerMinZoom: number | undefined): number {
  return Math.max(layerMinZoom ?? 0, COVERAGE_MIN_ZOOM);
}
