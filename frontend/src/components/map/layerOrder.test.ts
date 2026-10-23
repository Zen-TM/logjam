import { readFileSync } from "node:fs";
import { join } from "node:path";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { TERRAIN_BASEMAP_ANCHORS } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { stackTopoLayers, TOPO_CEILING } from "./layerOrder";

/** A style's layer list, with MapLibre's `moveLayer` semantics. */
function fakeMap(ids: string[]) {
  return {
    ids,
    getLayer: (id: string) =>
      ids.includes(id) ? ({ id } as never) : undefined,
    moveLayer(id: string, before?: string) {
      ids.splice(ids.indexOf(id), 1);
      ids.splice(before ? ids.indexOf(before) : ids.length, 0, id);
    },
  };
}

describe("stackTopoLayers", () => {
  // Mutation: start from the top of the style instead of `TOPO_CEILING`, and
  // the slope bands tint every route and track drawn under them.
  it("puts the topo band over the basemap and under the tracks and routes", () => {
    const map = fakeMap([
      "basemap",
      TOPO_CEILING,
      "routes-lines",
      "place-circles",
      "topo-slope-dem",
      "topo-hillshade-dem",
      "topo-job-contours",
      "topo-job-labels",
    ]);
    stackTopoLayers(map, [
      ["topo-hillshade-dem"],
      ["topo-slope-dem"],
      ["topo-gone-dem"],
      ["topo-job-contours", "topo-job-labels"],
    ]);
    expect(map.ids).toEqual([
      "basemap",
      "topo-hillshade-dem",
      "topo-slope-dem",
      "topo-job-contours",
      "topo-job-labels",
      TOPO_CEILING,
      "routes-lines",
      "place-circles",
    ]);
  });
});

// Mutation: add a track, route or pin layer in Map.tsx before the ceiling, and
// it draws under the topo band.
describe("TOPO_CEILING", () => {
  it("is the first layer Map.tsx adds by name", () => {
    const source = readFileSync(join(__dirname, "Map.tsx"), "utf8");
    expect(/\bid: "([^"]+)"/.exec(source)?.[1]).toBe(TOPO_CEILING);
  });
});

// Mutation: rename an anchor, or pick one the roads or labels sit under, and
// the Terrain group lands nowhere, or over them.
describe("TERRAIN_BASEMAP_ANCHORS in the vector basemap Logjam Web draws", () => {
  const style = layers("protomaps", namedFlavor("light"), { lang: "en" });
  const index = (id: string) => style.findIndex((layer) => layer.id === id);

  it("are layers of the style, the shading's under the slope's", () => {
    for (const anchor of Object.values(TERRAIN_BASEMAP_ANCHORS))
      expect(index(anchor), anchor).toBeGreaterThan(0);
    expect(index(TERRAIN_BASEMAP_ANCHORS.hillshade)).toBeLessThan(
      index(TERRAIN_BASEMAP_ANCHORS.slope),
    );
  });

  it("leave every road, boundary and label above the contours", () => {
    const contours = index(TERRAIN_BASEMAP_ANCHORS.contours);
    // Airport surfaces, drawn with the land fills: under the band is fine.
    const airfield = ["roads_runway", "roads_taxiway"];
    const above = style.filter(
      (layer) =>
        layer.type === "symbol" ||
        layer.id.startsWith("boundaries") ||
        (layer.id.startsWith("roads_") && !airfield.includes(layer.id)),
    );
    for (const layer of above)
      expect(index(layer.id), layer.id).toBeGreaterThanOrEqual(contours);
  });
});
