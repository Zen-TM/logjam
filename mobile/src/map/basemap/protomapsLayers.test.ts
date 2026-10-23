import { TERRAIN_BASEMAP_ANCHORS } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { protomapsLayerDefs, type ProtomapsFlavor } from "./protomapsLayers";

// Mutation: rename an anchor, regenerate the style without it, or pick one the
// roads or labels sit under, and the Terrain group waits for a layer that
// never mounts, or draws over them.
describe.each<ProtomapsFlavor>(["light", "dark"])(
  "TERRAIN_BASEMAP_ANCHORS in the %s basemap Logjam GPS draws",
  (flavor) => {
    const style = protomapsLayerDefs(flavor);
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
  },
);
