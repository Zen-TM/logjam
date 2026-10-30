import { readFileSync } from "node:fs";
import { join } from "node:path";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { drawsOverTerrain, TERRAIN_BASEMAP_ANCHORS } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import {
  GAUGE_BELOW,
  GAUGE_LAYER,
  moveTerrainIntoBasemap,
  stackTopoLayers,
  TOPO_CEILING,
} from "./layerOrder";

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

describe("moveTerrainIntoBasemap", () => {
  // Mutation: move the layers bottom first, and a layer goes under one of its
  // own group still in the topo band: the contour lines stay over the roads.
  it("takes the Terrain group out of the band and under the roads and labels", () => {
    const map = fakeMap([
      "pm-earth",
      "pm-landcover",
      "pm-water",
      "pm-water_stream",
      "pm-roads_minor",
      "pm-places_locality",
      "topo-nswhillshade-dem",
      "topo-nswslope-dem",
      "topo-nswcontours-minor",
      "topo-nswcontours-labels",
      "topo-job-contours",
      TOPO_CEILING,
    ]);
    moveTerrainIntoBasemap(
      map,
      {
        contours: ["topo-nswcontours-minor", "topo-nswcontours-labels"],
        slope: ["topo-nswslope-dem"],
        hillshade: ["topo-nswhillshade-dem"],
      },
      "pm-",
    );
    expect(map.ids).toEqual([
      "pm-earth",
      "pm-landcover",
      "topo-nswhillshade-dem",
      "pm-water",
      "topo-nswslope-dem",
      "topo-nswcontours-minor",
      "topo-nswcontours-labels",
      "pm-water_stream",
      "pm-roads_minor",
      "pm-places_locality",
      "topo-job-contours",
      TOPO_CEILING,
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

  it("leave every road, boundary and label above the whole Terrain group", () => {
    const top = Math.max(...Object.values(TERRAIN_BASEMAP_ANCHORS).map(index));
    for (const layer of style.filter(drawsOverTerrain))
      expect(index(layer.id), layer.id).toBeGreaterThanOrEqual(top);
  });
});

// Mutation: add the gauge layer before the pins' highlights are added, or drop
// it from PRESSABLE, and a gauge draws over a pin or a gauge press also opens
// the point popover.
describe("GAUGE_LAYER", () => {
  const source = readFileSync(join(__dirname, "Map.tsx"), "utf8");

  it("is added over the topo ceiling and under the pins", () => {
    expect(source.indexOf("id: GAUGE_LAYER")).toBeGreaterThan(
      source.indexOf(`id: "${TOPO_CEILING}"`),
    );
    expect(source).toContain(`GAUGE_BELOW,\n      );`);
    expect(source.indexOf(`id: "${GAUGE_BELOW}"`)).toBeLessThan(
      source.indexOf("id: GAUGE_LAYER"),
    );
  });

  it("is pressable, so a gauge press does not also ask 'what is here?'", () => {
    const pressable = /const PRESSABLE = \[([^\]]*)\]/.exec(source)?.[1];
    expect(pressable).toContain("GAUGE_LAYER");
    expect(GAUGE_LAYER).toBe("gauge-circles");
  });
});
