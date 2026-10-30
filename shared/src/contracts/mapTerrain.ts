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
    // Only while a sharpened area of the user's has a vegetation layer.
    { key: "vegetation" },
    {
      key: "sharpenedAreas",
      on: "web",
      reason:
        "Making, sharing and deleting sharpened areas is planning, done at home: Logjam GPS draws the ones the account has and saves them from Saved.",
    },
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
    vegetation: "Vegetation",
    sharpenedAreas: "Sharpened areas",
    vegetationHint: "Scrub density for bushbashing",
    // Behind the Vegetation row's help button, titled with its label.
    vegetationAbout: "About vegetation",
    vegetationLegend:
      "Scrub density for bushbashing: denser reads darker. Orange crosshatching is ground burnt since the survey.",
    slopeBands: "Slope bands",
    // The Contours switch over a topographic sheet, which has its own.
    contoursPrinted: "This map prints its own",
    // The Hillshade switch over imagery.
    hillshadeImagery: "The photos have their own shadows",
  },
} as const satisfies ScreenContract;
