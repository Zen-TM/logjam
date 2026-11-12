import {
  COVERAGE_HATCH_IMAGE,
  COVERAGE_MIN_ZOOM,
  coverageFilter,
  coverageOpacity,
  NSW_COVERAGE,
  zoomFadeIn,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { coverageLayerSpec } from "./coverageLayers";
import { COVERAGE_FILL_LAYER } from "./layerOrder";
import { TERRAIN_ENTRIES } from "./terrainEntries";

describe("the Coverage layer", () => {
  // Mutation: write a pattern, opacity, filter or zoom into the layer by hand
  // instead of shared's, or drop the fade, and Logjam Web's hatch drifts from
  // Logjam GPS's, or pops in at its first zoom.
  it("is drawn by exactly shared's expressions, for the one carrier", () => {
    expect(coverageLayerSpec("topo-src-nswcoverage", "optus")).toEqual({
      id: COVERAGE_FILL_LAYER,
      type: "fill",
      source: "topo-src-nswcoverage",
      "source-layer": NSW_COVERAGE.sourceLayer,
      minzoom: COVERAGE_MIN_ZOOM,
      filter: coverageFilter("optus"),
      paint: {
        "fill-pattern": COVERAGE_HATCH_IMAGE,
        "fill-opacity": zoomFadeIn(COVERAGE_MIN_ZOOM, coverageOpacity()),
      },
    });
  });

  // Mutation: rename the entry or the layer alone, and the stack and the
  // basemap move never find it: Map.tsx owns `topo-<entry id>-*`.
  it("belongs to the coverage entry", () => {
    expect(
      COVERAGE_FILL_LAYER.startsWith(`topo-${TERRAIN_ENTRIES.coverage.id}-`),
    ).toBe(true);
  });
});
