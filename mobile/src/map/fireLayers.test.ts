import {
  fireColor,
  fireEdgeOpacity,
  fireFillOpacity,
  NSW_FIRE,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";
import { fireLayerIds, fireLayerPaints, fireMinZoom } from "./fireLayers";

const NOW = new Date(2026, 10, 7);

describe("fireLayerPaints", () => {
  // Mutation: build the fill from `fireEdgeOpacity`, or take `new Date()`
  // here instead of `now`, and the paint no longer equals shared's.
  it("paints with exactly shared's expressions", () => {
    const { fill, edge } = fireLayerPaints(NOW);
    expect(fill).toEqual({
      "fill-color": fireColor(NOW),
      "fill-opacity": fireFillOpacity(NOW),
    });
    expect(edge).toEqual({
      "line-color": fireColor(NOW),
      "line-width": 1,
      "line-opacity": fireEdgeOpacity(NOW),
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
  // below the archive's own first zoom.
  it("never draws below the archive's first zoom", () => {
    expect(fireMinZoom(undefined)).toBe(NSW_FIRE.minzoom);
    expect(fireMinZoom(NSW_FIRE.minzoom - 2)).toBe(NSW_FIRE.minzoom);
    expect(fireMinZoom(NSW_FIRE.minzoom + 1)).toBe(NSW_FIRE.minzoom + 1);
  });
});
