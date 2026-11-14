import { describe, expect, it } from "vitest";

import { overlayAttributionLines } from "./geoPdfBaseLayers.js";
import {
  LAND_EDGE_LINES,
  LAND_TILE_MARGIN_PX,
  landClass,
  landColor,
  landNameOf,
} from "./land.js";
import { MAP_TERRAIN } from "./contracts/mapTerrain.js";
import { NSW_REGION } from "./regions.js";
import { SIM_NZ, SIM_UTAH } from "./simRegions.js";

const land = NSW_REGION.terrain.land;
const LAND_CLASSES = land.classes;

describe("landColor", () => {
  // Mutation: leave a class out of the expression, and that land is undrawn
  // and reads as no data at all.
  it("colours every class its own colour, and nothing else", () => {
    const expression = landColor(land);
    expect(expression.slice(0, 2)).toEqual([
      "match",
      ["get", land.classProperty],
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
    properties: { [land.classProperty]: value },
  });

  // Mutation: show the source's word, and "Indigenous Owned" labels NPWS
  // reserves as ownership the layer doesn't record.
  it("names a class in the words a person reads", () => {
    expect(landNameOf(land, [feature("Private")])).toBe("Private land");
    expect(landNameOf(land, [feature("Indigenous Owned")])).toBe(
      "Aboriginal Area",
    );
  });

  it("names nothing where nothing is drawn, or for a value that is no class", () => {
    expect(landNameOf(land, [])).toBeNull();
    expect(landNameOf(land, [feature("Unknown")])).toBeNull();
    expect(landNameOf(land, [{ properties: null }])).toBeNull();
    expect(landClass(land, undefined)).toBeUndefined();
  });
});

describe("what Land says", () => {
  // Mutation: name a class "No access" in any region, and the map answers a
  // question no dataset here can.
  it("says who holds the land, never whether you may go there", () => {
    for (const region of [NSW_REGION, SIM_NZ, SIM_UTAH]) {
      const archive = region.terrain.land!;
      const words = [
        ...archive.classes.map((c) => c.name),
        MAP_TERRAIN.copy.landLegend,
        archive.caveat,
      ].join(" ");
      expect(words).not.toMatch(
        /\b(allowed|no access|restricted|forbidden)\b/i,
      );
    }
    expect(MAP_TERRAIN.copy.landLegend).toMatch(/not whether you may enter/);
  });
});

describe("a region's own land vocabulary", () => {
  const nz = SIM_NZ.terrain.land!;

  // Mutation: read NSW's classes or property in `landColor` or `landNameOf`
  // and a second region draws NSW's tenure words, or nothing.
  it("draws and names the classes of the archive it is given", () => {
    expect(landColor(nz)).toEqual([
      "match",
      ["get", "Holder"],
      "Public",
      "#2a9d8f",
      "Leased",
      "#e9c46a",
      "Owned",
      "#9b5de5",
      "rgba(0,0,0,0)",
    ]);
    const hit = (value: string) => [{ properties: { Holder: value } }];
    expect(landNameOf(nz, hit("Public"))).toBe("Simulated public land");
    expect(landNameOf(nz, hit("Private"))).toBeNull();
    expect(landNameOf(land, hit("Public"))).toBeNull();
  });
});

describe("Land's credit", () => {
  // Mutation: drop `land` from TOPO_OVERLAY_SOURCE, and a print shows CC BY
  // data with no credit.
  it("goes on a print", () => {
    expect(overlayAttributionLines(["land"])).toEqual([
      NSW_REGION.terrain.land.credit,
    ]);
  });
});
