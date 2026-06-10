import { describe, it, expect } from "vitest";
import {
  overlayAttributionLines,
  GEOPDF_OVERLAY_ATTRIBUTION,
} from "./geoPdfBaseLayers.js";

describe("overlayAttributionLines", () => {
  it("credits both elevation and vegetation sources for the vegetation layer", () => {
    expect(overlayAttributionLines(["hillshade", "vegetation"])).toEqual([
      GEOPDF_OVERLAY_ATTRIBUTION.elevation,
      GEOPDF_OVERLAY_ATTRIBUTION.vegetation,
    ]);
  });

  it("dedupes multiple elevation-derived layers to a single line", () => {
    expect(overlayAttributionLines(["hillshade", "slope", "contours"])).toEqual([
      GEOPDF_OVERLAY_ATTRIBUTION.elevation,
    ]);
  });

  it("returns an empty array for no overlays", () => {
    expect(overlayAttributionLines([])).toEqual([]);
  });

  it("ignores unknown layer names", () => {
    expect(overlayAttributionLines(["unknown-layer"])).toEqual([]);
  });

  it("orders output by OVERLAY_SOURCE_ORDER regardless of input order", () => {
    expect(overlayAttributionLines(["features", "hillshade"])).toEqual([
      GEOPDF_OVERLAY_ATTRIBUTION.elevation,
      GEOPDF_OVERLAY_ATTRIBUTION.features,
    ]);
  });
});
