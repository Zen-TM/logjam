import {
  FIRE_MIN_ZOOM,
  fireColor,
  fireEdgeOpacity,
  NSW_REGION,
  fireFillOpacity,
  zoomFadeIn,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";
import { fireLayerIds, fireLayerPaints, fireMinZoom } from "./fireLayers";

const NOW = new Date(2026, 10, 7);
const FIRE = NSW_REGION.terrain.fire;

describe("fireLayerPaints", () => {
  // Mutation: build the fill from `fireEdgeOpacity`, or take `new Date()`
  // here instead of `now`, and the paint no longer equals shared's.
  it("paints with exactly shared's expressions", () => {
    const { fill, edge } = fireLayerPaints(FIRE, NOW);
    expect(fill).toEqual({
      "fill-color": fireColor(FIRE, NOW),
      "fill-opacity": zoomFadeIn(FIRE_MIN_ZOOM, fireFillOpacity(FIRE, NOW)),
    });
    expect(edge).toEqual({
      "line-color": fireColor(FIRE, NOW),
      "line-width": 1,
      "line-opacity": zoomFadeIn(FIRE_MIN_ZOOM, fireEdgeOpacity(FIRE, NOW)),
    });
  });
});

describe("fireLayerIds", () => {
  // Mutation: swap the pair, and the edge is stacked under the tint.
  it("lists the tint before the edge, one pair per source", () => {
    const [fill, edge] = fireLayerIds("a");
    expect(fill).not.toBe(edge);
    expect(fireLayerIds("b")).not.toEqual(fireLayerIds("a"));
    expect(edge).toContain("edge");
    expect(fill).not.toContain("edge");
  });
});

describe("fireMinZoom", () => {
  // Mutation: return `layerMinZoom ?? 0` alone, and a CDN source draws fire
  // below the zoom it fades in from.
  it("never draws below FIRE_MIN_ZOOM", () => {
    expect(fireMinZoom(undefined)).toBe(FIRE_MIN_ZOOM);
    expect(fireMinZoom(FIRE_MIN_ZOOM - 2)).toBe(FIRE_MIN_ZOOM);
    expect(fireMinZoom(FIRE_MIN_ZOOM + 1)).toBe(FIRE_MIN_ZOOM + 1);
  });
});
