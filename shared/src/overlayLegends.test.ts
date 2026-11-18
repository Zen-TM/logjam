import { describe, expect, it } from "vitest";

import vocabulary from "./__fixtures__/nswOverlayVocabulary.json" with {
  type: "json",
};
import {
  COVERAGE_HATCH_IMAGE,
  COVERAGE_HATCH_URIS,
  coverageFilter,
  coverageOpacity,
} from "./coverage.js";
import { fireColor, fireEdgeOpacity, fireFillOpacity } from "./fireHistory.js";
import { landColor } from "./land.js";
import { OVERLAY_LEGENDS, overlayLegends } from "./overlayLegends.js";
import { NSW_REGION } from "./regions.js";
import { SIM_NZ, SIM_UTAH } from "./simRegions.js";

// `nswOverlayVocabulary.json` holds what NSW's overlays produce: the legends
// (class colours, carrier list, caveat copy, credits) and the style
// expressions (the fire ones for 7 Nov 2026). It is kept apart from the
// declaration, so a change to NSW's values is an edit of both.
describe("what New South Wales's overlays draw and say", () => {
  const legends = JSON.parse(JSON.stringify(vocabulary.legends));
  legends.coverage.rows[0].pattern = COVERAGE_HATCH_URIS[COVERAGE_HATCH_IMAGE];

  // Mutation: change a class colour, a carrier, a caveat or a credit in
  // NSW's archives.
  it("keeps the legends as they were", () => {
    expect(JSON.parse(JSON.stringify(OVERLAY_LEGENDS))).toEqual(legends);
  });

  // Mutation: change a class colour, a property name or a ramp stop.
  it("keeps the style expressions as they were", () => {
    const now = new Date(2026, 10, 7);
    const { land, fire, coverage } = NSW_REGION.terrain;
    expect(landColor(land)).toEqual(vocabulary.land);
    expect(fireColor(fire, now)).toEqual(vocabulary.fireColor);
    expect(fireFillOpacity(fire, now)).toEqual(vocabulary.fill);
    expect(fireEdgeOpacity(fire, now)).toEqual(vocabulary.edge);
    expect(coverageFilter(coverage, "optus")).toEqual(vocabulary.filter);
    expect(coverageOpacity(coverage)).toEqual(vocabulary.opacity);
  });
});

describe("overlayLegends", () => {
  // Mutation: read NSW's caveats or classes whatever region is given.
  it("takes each region's own classes, carriers, caveat and credit", () => {
    const nz = overlayLegends(SIM_NZ);
    expect(nz.land?.rows.map((r) => r.label)).toEqual([
      "Simulated public land",
      "Simulated leased land",
      "Simulated owned land",
    ]);
    expect(nz.coverage?.choice?.options).toEqual([
      { value: "simone", label: "Simulated One" },
      { value: "simtwo", label: "Simulated Two" },
    ]);
    for (const key of ["land", "fire", "coverage"] as const) {
      expect(nz[key]?.caveat).toBe(SIM_NZ.terrain[key]!.caveat);
      expect(nz[key]?.credit).toBe(SIM_NZ.terrain[key]!.credit);
      expect(nz[key]?.caveat).not.toBe(OVERLAY_LEGENDS[key].caveat);
    }
  });

  // Mutation: build a legend for a layer the region has no archive for.
  it("has no legend for an overlay the region lacks", () => {
    expect(Object.keys(overlayLegends(SIM_UTAH))).toEqual(["land", "fire"]);
    expect(overlayLegends(null)).toEqual({});
  });
});
