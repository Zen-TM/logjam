import { describe, expect, it } from "vitest";

import { BASEMAP_CATALOG } from "./geoPdfBaseLayers.js";
import {
  contourLabelHalo,
  drawsNswContours,
  drawsNswHillshade,
  takesContours,
  takesHillshade,
  nswContourStyle,
} from "./contourRules.js";
import { VECTOR_STYLE_DEFAULTS } from "./topoSettings.js";
import { NSW_REGION } from "./regions.js";

describe("drawsNswContours", () => {
  it("draws over the vector basemap and imagery while the switch is on", () => {
    expect(drawsNswContours("protomaps", true)).toBe(true);
    expect(drawsNswContours("six-imagery", true)).toBe(true);
  });

  // Mutation: drop `on` from the vector arm, and the switch cannot hide them.
  it("draws nowhere while the switch is off", () => {
    expect(drawsNswContours("protomaps", false)).toBe(false);
    expect(drawsNswContours("six-imagery", false)).toBe(false);
  });

  // Mutation: drop the `printsContours` test, and the sheets that print their
  // own contours get a second set on top.
  it("never draws over a basemap that prints its own", () => {
    const printing = BASEMAP_CATALOG.filter((entry) => entry.printsContours);
    expect(printing.map((entry) => entry.id)).toEqual([
      "osm-topo",
      "osm-cycle",
      "six-topo",
      "six-base",
    ]);
    for (const { id } of printing) {
      expect(drawsNswContours(id, true)).toBe(false);
      expect(takesContours(id)).toBe(false);
    }
  });

  // Mutation: let an unknown id through, and a basemap the catalogue does not
  // hold is drawn under contours nobody checked fit it.
  it("takes none for an id the catalogue does not hold", () => {
    expect(takesContours("no-such-basemap")).toBe(false);
  });

  it("credits the contours, not the elevation", () => {
    expect(NSW_REGION.terrain.contours.credit).toMatch(
      /^Contours: derived from the NSW 5 m/,
    );
  });
});

describe("drawsNswHillshade", () => {
  // Mutation: drop the `photo` test, and the shading doubles the photographs'.
  it("draws over every basemap but photographs while the switch is on", () => {
    for (const { id } of BASEMAP_CATALOG)
      expect(drawsNswHillshade(id, true)).toBe(id !== "six-imagery");
    expect(takesHillshade("six-imagery")).toBe(false);
    expect(takesHillshade("protomaps")).toBe(true);
  });

  it("draws nowhere while the switch is off", () => {
    expect(drawsNswHillshade("protomaps", false)).toBe(false);
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
