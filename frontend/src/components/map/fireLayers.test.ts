import {
  FIRE_MIN_ZOOM,
  fireColor,
  fireEdgeOpacity,
  fireFillOpacity,
  NSW_FIRE,
  zoomFadeIn,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { fireLayerSpecs } from "./fireLayers";
import { FIRE_EDGE_LAYER, FIRE_FILL_LAYER } from "./layerOrder";
import { TERRAIN_ENTRIES } from "./terrainEntries";

const NOV_2026 = new Date(2026, 10, 7);

describe("the Fire history layers", () => {
  // Mutation: write a colour, opacity or zoom into the layer by hand instead
  // of shared's ramp, and Logjam Web's tint drifts from Logjam GPS's.
  it("are painted by exactly shared's ramp, from its source layer and zoom", () => {
    const [fill, edge] = fireLayerSpecs("topo-src-nswfire", NOV_2026);
    expect(fill).toMatchObject({
      id: FIRE_FILL_LAYER,
      type: "fill",
      source: "topo-src-nswfire",
      "source-layer": NSW_FIRE.sourceLayer,
      minzoom: FIRE_MIN_ZOOM,
      paint: {
        "fill-color": fireColor(NOV_2026),
        "fill-opacity": zoomFadeIn(FIRE_MIN_ZOOM, fireFillOpacity(NOV_2026)),
      },
    });
    expect(edge).toMatchObject({
      id: FIRE_EDGE_LAYER,
      type: "line",
      source: "topo-src-nswfire",
      "source-layer": NSW_FIRE.sourceLayer,
      minzoom: FIRE_MIN_ZOOM,
      paint: {
        "line-color": fireColor(NOV_2026),
        "line-width": 1,
        "line-opacity": zoomFadeIn(FIRE_MIN_ZOOM, fireEdgeOpacity(NOV_2026)),
      },
    });
  });

  // Mutation: list the edge before the tint, and the tint paints over the
  // boundary it should sit under.
  it("puts the tint under its edge", () => {
    expect(fireLayerSpecs("s", NOV_2026).map((layer) => layer.id)).toEqual([
      FIRE_FILL_LAYER,
      FIRE_EDGE_LAYER,
    ]);
  });

  // Mutation: credit the source with anything but NSW_FIRE's own line, and
  // the map's attribution drops a CC BY term of the data.
  it("credit the data on the map, by its CC BY licence", () => {
    expect(TERRAIN_ENTRIES.fire.attribution).toBe(NSW_FIRE.creditHtml);
    expect(NSW_FIRE.creditHtml).toContain("NPWS Fire History");
    expect(NSW_FIRE.creditHtml).toContain("CC BY 4.0");
  });
});
