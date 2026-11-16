// The map's Terrain group: a tab of the layers control on both clients
// (`MAP_LAYERS`), one switch per layer of the shape of the ground, listed top
// of the map first (`TERRAIN_LAYER_KEYS` in terrain.ts, which both clients
// also stack them by).
import type { ScreenContract } from "./types.js";
import { t } from "../i18n.js";

export const MAP_TERRAIN = {
  id: "map.terrain",
  title: t`Terrain`,
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
      reason: t`Making a sharpened area, and deleting it from the account, is planning, done at home: Logjam GPS draws the ones the account has and, from Saved, shares one, saves it and deletes its device copy.`,
    },
  ],
  copy: {
    // Each client's `switchCopy.test.ts` ("keeps to the limit") holds the
    // switches' labels and hints to `SWITCH_COPY_MAX`.
    contours: t`Contours`,
    slope: t`Slope`,
    land: t`Land tenure`,
    hillshade: t`Hillshade`,
    vegetation: t`Vegetation`,
    sharpenedAreas: t`Sharpened areas`,
    // Behind the Sharpened areas row's help button, titled with its label.
    sharpenedAreasAbout: t`About sharpened areas`,
    sharpenedAreasLegend: t`A sharpened area redraws contours, slope and hillshade from LiDAR you supply, at the survey's own detail instead of the statewide layers'. It is yours alone until you share it with a friend.`,
    vegetationHint: t`Scrub density for bushbashing`,
    // Behind the Vegetation row's help button, titled with its label.
    vegetationAbout: t`About vegetation`,
    vegetationLegend: t`Scrub density for bushbashing: denser reads darker. Orange stripes mark ground burnt since the survey, so the scrub there may have changed.`,
    // Land tenure, Fire history and Coverage stack with this group, but their
    // rows are in `MAP_OVERLAYS`: none is part of the shape of the ground.
    // Behind that row's help button, titled with its label.
    landAbout: t`About land tenure`,
    // Each source's own caveat is the region's (`LandArchive.caveat`).
    landLegend: t`Each colour shows who holds the land, not whether you may enter it. Crossing private land is up to its owner.`,
    fire: t`Fire history`,
    // Behind that row's help button, titled with its label; the legend's rows
    // are `fireLegendRows`.
    fireAbout: t`About fire history`,
    fireLegend: t`Each area is coloured by how long since it last burnt: darkest within the year, fading out by 10 years. Older fires and ground with no recorded fire have no colour.`,
    coverage: t`Coverage`,
    // Behind that row's help button, titled with its label, over a picker of
    // the region's carriers and a swatch of the hatch.
    coverageAbout: t`About coverage`,
    coverageCarrier: t`Your carrier`,
    // In place of the row's switch until a carrier is picked: the overlay
    // draws one carrier's map, and there is no default.
    coverageChooseCarrier: t`Choose your carrier`,
    coverageLegend: t`Hatching marks where your carrier's own model predicts no mobile reception for a phone in your hand outdoors.`,
    // What "What is here?" says after the carrier; the first is the
    // legend's swatch too.
    coverageNoReception: t`no mobile reception`,
    // The legend row's heading: the same words as a sentence of their own.
    coverageNoReceptionRow: t`No mobile reception`,
    coverageReception: t`mobile reception`,
    slopeBands: t`Slope bands`,
    // One sentence under each switch. Slope's colours are the account's bands,
    // so its key is `slopeLegendRows`, behind the row's help button.
    contoursHint: t`A line every 10 m of height`,
    slopeHint: t`Coloured by steepness`,
    hillshadeHint: t`Ridges and gullies stand out`,
    slopeAbout: t`About slope`,
    slopeLegend: t`Steepness in degrees from flat. An easy walk is under 10°, a steep scramble around 30°, and a cliff 45° or more. Ground flatter than the first band has no colour.`,
    // At the top of the editor on both clients.
    slopeBandsIntro: t`Colour terrain based on how steep it is.`,
    // The Contours switch over a topographic sheet, which has its own.
    contoursPrinted: t`This map prints its own`,
    // The Hillshade switch over imagery.
    hillshadeImagery: t`The photos have their own shadows`,
    // A layer's switch where the ground on screen has no data for it.
    notHere: t`Not available here`,
  },
} as const satisfies ScreenContract;
