import { describe, expect, it } from "vitest";

import { overlayAttributionLines } from "./geoPdfBaseLayers.js";
import {
  LAND_CLASSES,
  LAND_EDGE_LINES,
  LAND_TILE_MARGIN_PX,
  NSW_LAND,
  landClass,
  landColor,
  landNameOf,
} from "./nswLand.js";
import { MAP_TERRAIN } from "./contracts/mapTerrain.js";

describe("landColor", () => {
  // Mutation: leave a class out of the expression, and that land is undrawn
  // and reads as no data at all.
  it("colours every class its own colour, and nothing else", () => {
    const expression = landColor();
    expect(expression.slice(0, 2)).toEqual([
      "match",
      ["get", NSW_LAND.classProperty],
    ]);
    for (const { source, colour } of LAND_CLASSES) {
      const at = expression.indexOf(source);
      expect(expression[at + 1]).toBe(colour);
    }
    expect(expression.at(-1)).toBe("rgba(0,0,0,0)");
  });

  // Mutation: reuse a colour, and the legend can't tell two holders apart.
  it("gives no two classes one colour", () => {
    const colours = LAND_CLASSES.map((c) => c.colour);
    expect(new Set(colours).size).toBe(colours.length);
  });
});

describe("LAND_EDGE_LINES", () => {
  // Mutation: widen a soft line past the margin, and a holding's glow runs
  // along every tile edge across it, drawing the tile grid.
  it("stays inside the margin a tile's polygons run past its edge", () => {
    for (const { width, offset } of LAND_EDGE_LINES)
      expect(offset + width / 2).toBeLessThan(LAND_TILE_MARGIN_PX);
  });

  // Mutation: centre a line on the border, and each holding's colour spills
  // into its neighbour's side.
  it("keeps each line wholly inside its own holding", () => {
    for (const { width, offset } of LAND_EDGE_LINES)
      expect(offset).toBeGreaterThanOrEqual(width / 2);
  });
});

describe("landNameOf", () => {
  const feature = (value: unknown) => ({
    properties: { [NSW_LAND.classProperty]: value },
  });

  // Mutation: show the source's word, and "Indigenous Owned" labels NPWS
  // reserves as ownership the layer doesn't record.
  it("names a class in the words a person reads", () => {
    expect(landNameOf([feature("Private")])).toBe("Private land");
    expect(landNameOf([feature("Indigenous Owned")])).toBe("Aboriginal Area");
  });

  it("names nothing where nothing is drawn, or for a value that is no class", () => {
    expect(landNameOf([])).toBeNull();
    expect(landNameOf([feature("Unknown")])).toBeNull();
    expect(landNameOf([{ properties: null }])).toBeNull();
    expect(landClass(undefined)).toBeUndefined();
  });
});

describe("what Land says", () => {
  const words = [
    ...LAND_CLASSES.map((c) => c.name),
    MAP_TERRAIN.copy.landLegend,
    MAP_TERRAIN.copy.landCaveat,
  ].join(" ");

  // Mutation: name a class "No access", and the map answers a question no
  // dataset here can.
  it("says who holds the land, never whether you may go there", () => {
    expect(words).not.toMatch(/\b(allowed|no access|restricted|forbidden)\b/i);
    expect(MAP_TERRAIN.copy.landLegend).toMatch(/not whether you may enter/);
  });
});

describe("Land's credit", () => {
  // Mutation: drop `land` from TOPO_OVERLAY_SOURCE, and a print shows CC BY
  // data with no credit.
  it("goes on a print", () => {
    expect(overlayAttributionLines(["land"])).toEqual([NSW_LAND.credit]);
  });
});
