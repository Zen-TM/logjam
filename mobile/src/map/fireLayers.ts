// The Fire history overlay's two layers, as MapScreen mounts them: the tint,
// and a 1 px edge in the same colour (shared nswFire.ts holds the ramp).
import {
  FIRE_MIN_ZOOM,
  fireColor,
  fireEdgeOpacity,
  fireFillOpacity,
  zoomFadeIn,
} from "@logjam/shared";
import type {
  FillLayerSpecification,
  LineLayerSpecification,
} from "@maplibre/maplibre-react-native";

type FillPaint = NonNullable<FillLayerSpecification["paint"]>;
type LinePaint = NonNullable<LineLayerSpecification["paint"]>;

/** Bottom first: the edge lies over the tint. */
export function fireLayerIds(sourceKey: string): [fill: string, edge: string] {
  return [`nsw-fire-${sourceKey}`, `nsw-fire-edge-${sourceKey}`];
}

/** The paint as of `now`, which a mount takes once. */
export function fireLayerPaints(now: Date): {
  fill: FillPaint;
  edge: LinePaint;
} {
  return {
    fill: {
      "fill-color": fireColor(now) as FillPaint["fill-color"],
      "fill-opacity": zoomFadeIn(
        FIRE_MIN_ZOOM,
        fireFillOpacity(now),
      ) as FillPaint["fill-opacity"],
    },
    edge: {
      "line-color": fireColor(now) as LinePaint["line-color"],
      "line-width": 1,
      "line-opacity": zoomFadeIn(
        FIRE_MIN_ZOOM,
        fireEdgeOpacity(now),
      ) as LinePaint["line-opacity"],
    },
  };
}

/** Drawn from `FIRE_MIN_ZOOM`, or a clip's own first zoom if that is deeper. */
export function fireMinZoom(layerMinZoom: number | undefined): number {
  return Math.max(layerMinZoom ?? 0, FIRE_MIN_ZOOM);
}
