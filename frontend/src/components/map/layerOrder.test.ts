import { readFileSync } from "node:fs";
import { join } from "node:path";
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
