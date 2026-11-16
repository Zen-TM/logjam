import type { Catalogue } from "../i18n.js";

/**
 * US English, as differences from the source text (Australian English) only:
 * `"Abseil": "Rappel"`. A key is a message's English with each hole written
 * `{0}`, `{1}`, … (docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md).
 *
 * What is left as the source writes it, and why, is `LEFT_AS_WRITTEN` in
 * `shared/src/i18nCoverage.test.ts`. A unit follows the region and the
 * account, not the language.
 */
export const enUS: Catalogue = {
  // The day forms (dateFormat.ts): the month before the day, the year after a comma.
  "<weekday> <day> <month> <year>": "<weekday>, <month> <day>, <year>",
  "<weekday>, <day> <month> <year>": "<weekday>, <month> <day>, <year>",
  "<weekday> <day> <month>": "<weekday>, <month> <day>",
  "<day> <month> <year>": "<month> <day>, <year>",
  "<day> <month>": "<month> <day>",
  "<day> <fullmonth>": "<fullmonth> <day>",
  "<day> <fullmonth> <year>": "<fullmonth> <day>, <year>",
  "<fullweekday>, <day> <fullmonth> <year>":
    "<fullweekday>, <fullmonth> <day>, <year>",
  "<day2>/<month2>/<year>": "<month2>/<day2>/<year>",
  Sept: "Sep",

  // Words and spellings.
  "A .zip of rasters in {0}, for QGIS or ArcGIS: heights in metres, slope in degrees, and hillshade.":
    "A .zip of rasters in {0}, for QGIS or ArcGIS: heights in meters, slope in degrees, and hillshade.",
  "A box to tick": "A box to check",
  "A carpark, a campsite, the exit.": "A parking lot, a campsite, the exit.",
  "A suburb is enough.": "A town or neighborhood is enough.",
  "About land tenure": "About land ownership",
  "Bushland greys with a hint of green, and fog-softened neutrals.":
    "Woodland grays with a hint of green, and fog-softened neutrals.",
  "Can you set up and do an abseil on your own?":
    "Can you set up and do a rappel on your own?",
  "Colour terrain based on how steep it is.":
    "Color terrain based on how steep it is.",
  Colour: "Color",
  "Coloured by steepness": "Colored by steepness",
  "Couldn't change the colour.": "Couldn't change the color.",
  "Band {0} colour, taken from the scale":
    "Band {0} color, taken from the scale",
  "Degrees from flat. An easy walk is under 10°, a steep scramble around 30°, and a cliff 45° or more. Each band starts where the one below it ends, so its neighbour follows what you set here.":
    "Degrees from flat. An easy walk is under 10°, a steep scramble around 30°, and a cliff 45° or more. Each band starts where the one below it ends, so its neighbor follows what you set here.",
  "Each area is coloured by how long since it last burnt: darkest within the year, fading out by 10 years. Older fires and ground with no recorded fire have no colour.":
    "Each area is colored by how long since it last burned: darkest within the year, fading out by 10 years. Older fires and ground with no recorded fire have no color.",
  "Each colour shows who holds the land, not whether you may enter it. Crossing private land is up to its owner.":
    "Each color shows who holds the land, not whether you may enter it. Crossing private land is up to its owner.",
  "For example, partner or mum.": "For example, partner or mom.",
  "Hatching marks where your carrier's own model predicts no mobile reception for a phone in your hand outdoors.":
    "Hatching marks where your carrier's own model predicts no cell reception for a phone in your hand outdoors.",
  "How am I going against my friends this season?":
    "How am I doing against my friends this season?",
  "How much canyoning and abseiling people have done.":
    "How much canyoneering and rappelling people have done.",
  "Invite cancelled.": "Invite canceled.",
  "Land tenure": "Land ownership",
  "Last burnt": "Last burned",
  "Mapped by NSW National Parks and Wildlife Service: a fire it didn't map, often on private land, has no colour.":
    "Mapped by NSW National Parks and Wildlife Service: a fire it didn't map, often on private land, has no color.",
  "Everyone you know is ticked.": "Everyone you know is checked.",
  "Mobile coverage": "Cell coverage",
  "Modelled rain, past {0} days": "Modeled rain, past {0} days",
  "Need a lift": "Need a ride",
  "No colour": "No color",
  "No mobile reception": "No cell reception",
  Ochre: "Ocher",
  "Pale smooth bark and grey-green leaves, for reading in full sun.":
    "Pale smooth bark and gray-green leaves, for reading in full sun.",
  "Reset colours": "Reset colors",
  "Scale end colour (the steepest band)": "Scale end color (the steepest band)",
  "Scale start colour (the shallowest band)":
    "Scale start color (the shallowest band)",
  "Scrub density for bushbashing": "Scrub density for bushwhacking",
  "Scrub density for bushbashing: denser reads darker. Orange stripes mark ground burnt since the survey, so the scrub there may have changed.":
    "Scrub density for bushwhacking: denser reads darker. Orange stripes mark ground burned since the survey, so the scrub there may have changed.",
  "Steepness in degrees from flat. An easy walk is under 10°, a steep scramble around 30°, and a cliff 45° or more. Ground flatter than the first band has no colour.":
    "Steepness in degrees from flat. An easy walk is under 10°, a steep scramble around 30°, and a cliff 45° or more. Ground flatter than the first band has no color.",
  "Tick list": "Checklist",
  "Tick only what you don't have.": "Check only what you don't have.",
  "Tick something to add.": "Check something to add.",
  "Tick the box to agree to the updated terms.":
    "Check the box to agree to the updated terms.",
  "Ties share a rank: two people level on most are both first.":
    "Ties share a rank: two people tied on most are both first.",
  "What comes out is drawn from the government's survey, and it may be wrong or out of date. Don't rely on it in place of your own navigation, judgement or rescue planning.":
    "What comes out is drawn from the government's survey, and it may be wrong or out of date. Don't rely on it in place of your own navigation, judgment or rescue planning.",
  "Who can drive, who needs a lift, and from where.":
    "Who can drive, who needs a ride, and from where.",
  "You cancelled this.": "You canceled this.",
  "Your private map and trips for canyoning in {0}.":
    "Your private map and trips for canyoneering in {0}.",
  "Your private map and trips for canyoning.":
    "Your private map and trips for canyoneering.",
  "mobile reception": "cell reception",
  "no mobile reception": "no cell reception",
  "{0} abseils": "{0} rappels",
};
