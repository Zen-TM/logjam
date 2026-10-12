import { describe, expect, it } from "vitest";

import { BASEMAP_CATALOG } from "./geoPdfBaseLayers.js";
import {
  NSW_CONTOURS,
  contourLabelHalo,
  drawsNswContours,
  nswContourStyle,
} from "./nswContours.js";
import { VECTOR_STYLE_DEFAULTS } from "./topoSettings.js";

describe("drawsNswContours", () => {
  it("draws with the vector basemap whatever the imagery setting", () => {
    expect(drawsNswContours("protomaps", false)).toBe(true);
  });

  it("draws over imagery only when asked", () => {
    expect(drawsNswContours("six-imagery", false)).toBe(false);
    expect(drawsNswContours("six-imagery", true)).toBe(true);
  });

  // Mutation: drop the basemap test from the imagery arm, and the sheets that
  // print their own contours get a second set on top.
  it("never draws over a basemap that prints its own", () => {
    const others = BASEMAP_CATALOG.map((entry) => entry.id).filter(
      (id) => id !== "protomaps" && id !== "six-imagery",
    );
    expect(others.length).toBeGreaterThan(0);
    for (const id of others) expect(drawsNswContours(id, true)).toBe(false);
  });

  it("credits the contours, not the elevation", () => {
    expect(NSW_CONTOURS.credit).toMatch(/^Contours: derived from the NSW 5 m/);
  });
});

describe("nswContourStyle", () => {
  it("is the default topo look on the vector basemap", () => {
    expect(nswContourStyle("protomaps")).toBe(VECTOR_STYLE_DEFAULTS);
  });

  // Mutation: return the same style over imagery, and the brown lines and
  // their white-haloed labels are lost on dark ground.
  it("draws light lines, with a dark label halo, over imagery", () => {
    const style = nswContourStyle("six-imagery");
    expect(style.contours.majorColour).toMatch(/^#ffffff/);
    expect(style.contours.majorWidthM).toBe(
      VECTOR_STYLE_DEFAULTS.contours.majorWidthM,
    );
    expect(contourLabelHalo(style.contours.majorColour)).toMatch(
      /^rgba\(0, 0, 0/,
    );
    expect(
      contourLabelHalo(VECTOR_STYLE_DEFAULTS.contours.majorColour),
    ).toMatch(/^rgba\(255, 255, 255/);
  });
});
