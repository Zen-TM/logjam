// The map's Terrain group: a tab of the layers control on both clients
// (`MAP_LAYERS`), one switch per layer of the shape of the ground, listed top
// of the map first (`TERRAIN_LAYER_KEYS` in terrain.ts, which both clients
// also stack them by).
import type { ScreenContract } from "./types.js";

export const MAP_TERRAIN = {
  id: "map.terrain",
  title: "Terrain",
  sections: [
    { key: "contours" },
    { key: "slope" },
    { key: "hillshade" },
    {
      key: "slopeBands",
      on: "web",
      reason:
        "Choosing the angles and colours of the slope bands is planning, done at home: Logjam GPS draws the bands the account has.",
    },
  ],
  copy: {
    contours: "Contours",
    slope: "Slope",
    hillshade: "Hillshade",
    slopeBands: "Slope bands",
    // The Contours switch over a topographic sheet, which has its own.
    contoursPrinted: "This map prints its own",
  },
} as const satisfies ScreenContract;
