// The Coverage overlay as MapScreen mounts it: one hatched fill, with the
// hatch image registered beside it (shared nswCoverage.ts holds the levels).
import {
  type CarrierId,
  COVERAGE_HATCH_IMAGE,
  COVERAGE_HATCH_PIXEL_RATIO,
  COVERAGE_HATCH_URIS,
  COVERAGE_MIN_ZOOM,
  coverageFilter,
  coverageNameOf,
  coverageOpacity,
  normalizeCarrier,
  OVERLAY_LEGENDS,
  overlayAwaitsChoice,
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

/**
 * "What is here?"'s coverage figure for a press at `point` (dp) and `at`
 * ([lng, lat], the same spot): the map's own query of the coverage layers
 * there, named for `carrier` by shared `coverageNameOf`, which drops the
 * polygons MapLibre Native returns for a point in one of their holes. Null
 * with no carrier or no coverage layer drawn.
 */
export async function coverageAtTap(
  map:
    | {
        queryRenderedFeatures(
          point: [number, number],
          options: { layers: string[] },
        ): Promise<
          readonly {
            properties?: Record<string, unknown> | null;
            geometry?: { type: string; coordinates?: unknown } | null;
          }[]
        >;
      }
    | null
    | undefined,
  point: [number, number],
  at: readonly [number, number],
  layers: readonly string[],
  carrier: CarrierId | null,
): Promise<string | null> {
  if (!map || !carrier || layers.length === 0) return null;
  const features = await map.queryRenderedFeatures(point, {
    layers: [...layers],
  });
  return coverageNameOf(features, carrier, at);
}

/**
 * A carrier picked in the Coverage legend: stored, and the overlay turned on
 * when it was the row's first pick (`overlayAwaitsChoice`) and its switch can
 * be on. Offline with no saved clip the switch is disabled, so the overlay is
 * left as it was rather than stored on behind a switch that says why it can't.
 */
export function pickCoverageCarrier(
  value: string,
  previous: CarrierId | null,
  switchDisabled: boolean,
  on: { choose: (id: CarrierId) => void; turnOn: () => void },
): void {
  const next = normalizeCarrier(value);
  if (!next) return;
  if (
    !switchDisabled &&
    overlayAwaitsChoice(OVERLAY_LEGENDS.coverage, previous)
  )
    on.turnOn();
  on.choose(next);
}
