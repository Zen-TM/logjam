import {
  COVERAGE_HATCH_IMAGE,
  COVERAGE_MIN_ZOOM,
  coverageFilter,
  coverageOpacity,
  NSW_REGION,
  zoomFadeIn,
  SIM_NZ,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { coverageLayerSpec } from "./coverageLayers";
import { coverageFillLayer } from "./layerOrder";
import { terrainEntries } from "./terrainEntries";

const NSW_COVERAGE = NSW_REGION.terrain.coverage;

describe("the Coverage layer", () => {
  // Mutation: write a pattern, opacity, filter or zoom into the layer by hand
  // instead of shared's, or drop the fade, and Logjam Web's hatch drifts from
  // Logjam GPS's, or pops in at its first zoom.
  it("is drawn by exactly shared's expressions, for the one carrier", () => {
    expect(
      coverageLayerSpec(NSW_REGION, "topo-src-nswcoverage", "optus"),
    ).toEqual({
      id: coverageFillLayer(NSW_REGION),
      type: "fill",
      source: "topo-src-nswcoverage",
      "source-layer": NSW_COVERAGE.sourceLayer,
      minzoom: COVERAGE_MIN_ZOOM,
      filter: coverageFilter(NSW_COVERAGE, "optus"),
      paint: {
        "fill-pattern": COVERAGE_HATCH_IMAGE,
        "fill-opacity": zoomFadeIn(
          COVERAGE_MIN_ZOOM,
          coverageOpacity(NSW_COVERAGE),
        ),
      },
    });
  });

  // Mutation: rename the entry or the layer alone, and the stack and the
  // basemap move never find it: Map.tsx owns `topo-<entry id>-*`.
  it("belongs to the coverage entry", () => {
    for (const region of [NSW_REGION, SIM_NZ])
      expect(
        coverageFillLayer(region).startsWith(
          `topo-${terrainEntries(region, []).coverage?.id}-`,
        ),
      ).toBe(true);
  });

  // Mutation: read NSW's archive whatever the region, and a map over another
  // region filters on NSW's carrier property; or build a layer for a region
  // with no coverage archive.
  it("is the region's own, and none where it has no coverage archive", () => {
    expect(coverageLayerSpec(SIM_NZ, "s", "simone")).toMatchObject({
      id: coverageFillLayer(SIM_NZ),
      "source-layer": SIM_NZ.terrain.coverage!.sourceLayer,
      filter: coverageFilter(SIM_NZ.terrain.coverage!, "simone"),
    });
    expect(
      coverageLayerSpec({ ...SIM_NZ, terrain: {} }, "s", "simone"),
    ).toBeNull();
  });
});
