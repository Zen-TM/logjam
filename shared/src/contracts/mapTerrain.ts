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
    // Opened from the Slope row on Logjam Web, a row of its own on Logjam GPS.
    { key: "slopeBands" },
    { key: "hillshade" },
    // Only while a sharpened area of the user's has a vegetation layer.
    { key: "vegetation" },
    {
      key: "sharpenedAreas",
      on: "web",
      reason:
        "Making a sharpened area, and deleting it from the account, is planning, done at home: Logjam GPS draws the ones the account has and, from Saved, shares one, saves it and deletes its device copy.",
    },
  ],
  copy: {
    contours: "Contours",
    slope: "Slope",
    land: "Land tenure",
    hillshade: "Hillshade",
    vegetation: "Vegetation",
    sharpenedAreas: "Sharpened areas",
    // Behind the Sharpened areas row's help button, titled with its label.
    sharpenedAreasAbout: "About sharpened areas",
    sharpenedAreasLegend:
      "A sharpened area redraws contours, slope and hillshade from LiDAR you supply, at the survey's own detail instead of the statewide layers'. It is yours alone until you share it with a friend.",
    vegetationHint: "Scrub density for bushbashing",
    // Behind the Vegetation row's help button, titled with its label.
    vegetationAbout: "About vegetation",
    vegetationLegend:
      "Scrub density for bushbashing: denser reads darker. Orange stripes mark ground burnt since the survey, so the scrub there may have changed.",
    // Land tenure, Fire history, Coverage and Weather stack with this group,
    // but their rows are in `MAP_OVERLAYS`: none is part of the shape of the
    // ground.
    // Behind that row's help button, titled with its label.
    landAbout: "About land tenure",
    landLegend:
      "Each colour shows who holds the land, not whether you may enter it. Crossing private land is up to its owner.",
    // The source's two known gaps, said beside the legend they qualify.
    landCaveat:
      "Land Council freehold can show as private land. Roads, waterways and public areas aren't properly mapped around Sydney and Wollongong.",
    fire: "Fire history",
    // Behind that row's help button, titled with its label; the legend's rows
    // are `fireLegendRows`.
    fireAbout: "About fire history",
    fireLegend:
      "Each area is coloured by how long since it last burnt: darkest within the year, fading out by 10 years. Older fires and ground with no recorded fire have no colour.",
    // The source's gap, said beside the legend it qualifies.
    fireCaveat:
      "Mapped by NSW National Parks and Wildlife Service: a fire it didn't map, often on private land, has no colour.",
    coverage: "Coverage",
    // Behind that row's help button, titled with its label, over a picker of
    // `CARRIERS` and a swatch of each hatch named by `COVERAGE_LEVELS`.
    coverageAbout: "About coverage",
    coverageCarrier: "Your carrier",
    coverageLegend:
      "Hatching marks where your carrier's own model predicts a phone in your hand won't work outdoors. Light hatching means only an external antenna reaches; dense hatching, nothing does.",
    // The source's limits, said beside the legend they qualify.
    coverageCaveat:
      "It's a prediction, and valley and canyon floors are where it's most often wrong. A reseller on Telstra's network may get less than Telstra's own.",
    weather: "Weather",
    // Behind that row's help button, titled with its label, over a picker of
    // `WEATHER_LAYERS` (named under the row) and the chosen layer's key.
    weatherAbout: "About the weather map",
    weatherLayer: "Show",
    weatherLegend:
      "ECMWF's forecast, coloured by what you pick. Drag the bar on the map to move through the week; past rain is the model's estimate of what fell, not a gauge's.",
    // The model's limits, said beside the key they qualify: one sentence.
    weatherCaveat:
      "Cells are about 9 km across, so this shows the big systems, not a storm over one catchment.",
    // The bar over the map while Weather is on.
    weatherEarlier: "Earlier",
    weatherLater: "Later",
    weatherLoading: "Getting the weather map…",
    weatherFailed: "Couldn't get the weather map.",
    weatherOutOfDate: "This forecast has run out.",
    slopeBands: "Slope bands",
    // One sentence under each switch. Slope's colours are the account's bands,
    // so its key is `slopeLegendRows`, behind the row's help button.
    contoursHint: "A line every 10 m of height",
    slopeHint: "Coloured by steepness",
    hillshadeHint: "Ridges and gullies stand out",
    slopeAbout: "About slope",
    slopeLegend:
      "Steepness in degrees from flat. An easy walk is under 10°, a steep scramble around 30°, and a cliff 45° or more. Ground flatter than the first band has no colour.",
    // At the top of the editor on both clients.
    slopeBandsIntro: "Colour terrain based on how steep it is.",
    // The Contours switch over a topographic sheet, which has its own.
    contoursPrinted: "This map prints its own",
    // The Hillshade switch over imagery.
    hillshadeImagery: "The photos have their own shadows",
  },
} as const satisfies ScreenContract;
