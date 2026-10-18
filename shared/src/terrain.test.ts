import { describe, expect, it } from "vitest";

import { NSW_5M } from "./demSources.js";
import {
  NSW_HILLSHADE,
  NSW_SLOPE,
  normalizeTerrainLayers,
  slopeReliefColor,
  TERRAIN_LAYER_DEFAULTS,
} from "./terrain.js";
import { normalizeUserUiPreferences } from "./themeSchemes.js";
import {
  parseSlopeBands,
  RASTER_TEMPLATE_DEFAULTS,
  rgbaCssFromHex,
  type SlopeBand,
} from "./topoSettings.js";

/**
 * The colour MapLibre draws at `degrees`: the stop at or below it, because
 * every pair of stops either side of a band edge is a hair apart, so between
 * them the colour is the one the band holds.
 */
function colourAt(expression: unknown[], degrees: number): unknown {
  const stops = expression.slice(3);
  let colour = stops[1];
  for (let i = 0; i < stops.length; i += 2)
    if ((stops[i] as number) <= degrees) colour = stops[i + 1];
  return colour;
}

const CLEAR = "rgba(0,0,0,0)";
const BANDS = RASTER_TEMPLATE_DEFAULTS.slope.bands;

describe("slopeReliefColor", () => {
  const expression = slopeReliefColor(BANDS);

  it("reads the archive's slope as its height", () => {
    expect(expression.slice(0, 3)).toEqual([
      "interpolate",
      ["linear"],
      ["elevation"],
    ]);
  });

  // Mutation: push one stop per edge instead of two, and every band fades into
  // the next over its whole width.
  it("paints each band in its own colour, with hard edges", () => {
    expect(colourAt(expression, 39.9)).toBe(CLEAR);
    expect(colourAt(expression, 40)).toBe(rgbaCssFromHex(BANDS[0]!.colour));
    expect(colourAt(expression, 49.99)).toBe(rgbaCssFromHex(BANDS[0]!.colour));
    expect(colourAt(expression, 50)).toBe(rgbaCssFromHex(BANDS[1]!.colour));
    expect(colourAt(expression, 90)).toBe(rgbaCssFromHex(BANDS[3]!.colour));
    const stops = expression.slice(3).filter((_, i) => i % 2 === 0);
    expect(stops).toEqual(
      [...stops].sort((a, b) => (a as number) - (b as number)),
    );
  });

  // Mutation: drop the leading clear stop, and no-data (−32768) clamps to the
  // first band's colour wherever a band starts at 0°.
  it("leaves no-data clear, even under a band from 0°", () => {
    const fromFlat: SlopeBand[] = [
      { fromDeg: 0, toDeg: 10, colour: "#00ff00ff" },
    ];
    const flat = slopeReliefColor(fromFlat);
    expect(colourAt(flat, -32768)).toBe(CLEAR);
    expect(colourAt(flat, 0)).toBe("rgba(0,255,0,1.000)");
  });

  it("clears everything above a top band short of 90°", () => {
    const low: SlopeBand[] = [{ fromDeg: 20, toDeg: 30, colour: "#ff0000ff" }];
    expect(colourAt(slopeReliefColor(low), 29.9)).toBe("rgba(255,0,0,1.000)");
    expect(colourAt(slopeReliefColor(low), 30)).toBe(CLEAR);
  });
});

describe("the statewide slope and hillshade", () => {
  it("credit the NSW 5 m DEM they are derived from", () => {
    expect(NSW_SLOPE.credit).toMatch(/^Slope: derived from the NSW 5 m/);
    expect(NSW_HILLSHADE.credit).toMatch(
      /^Hillshade: derived from the NSW 5 m/,
    );
  });

  it("are read from the archives the build writes", () => {
    expect(NSW_SLOPE.archivePath).toBe("master/dem/nsw-5m-slope.pmtiles");
    expect(NSW_HILLSHADE.archivePath).toBe(NSW_5M.archivePath);
  });
});

describe("normalizeTerrainLayers", () => {
  it("reads nothing stored as the defaults: contours only", () => {
    expect(normalizeTerrainLayers(null)).toEqual(TERRAIN_LAYER_DEFAULTS);
    expect(TERRAIN_LAYER_DEFAULTS).toEqual({
      contours: true,
      slope: false,
      hillshade: false,
    });
  });

  it("keeps what was stored and defaults the rest", () => {
    expect(normalizeTerrainLayers({ contours: false, slope: "yes" })).toEqual({
      contours: false,
      slope: false,
      hillshade: false,
    });
  });
});

describe("slope bands as an account preference", () => {
  const custom: SlopeBand[] = [
    { fromDeg: 30, toDeg: 45, colour: "#ffff00ff" },
    { fromDeg: 45, toDeg: 90, colour: "#ff0000ff" },
  ];

  it("defaults to the LiDAR job's bands", () => {
    expect(normalizeUserUiPreferences({}).slopeBands).toEqual(BANDS);
    expect(normalizeUserUiPreferences(null).slopeBands).toEqual(BANDS);
  });

  // Mutation: return the defaults' own array, and an edit of the preference
  // edits every LiDAR job's default bands with it.
  it("hands out a copy of the defaults", () => {
    expect(normalizeUserUiPreferences({}).slopeBands).not.toBe(BANDS);
    expect(normalizeUserUiPreferences({}).slopeBands[0]).not.toBe(BANDS[0]);
  });

  it("keeps the user's own bands", () => {
    expect(
      normalizeUserUiPreferences({ slopeBands: custom }).slopeBands,
    ).toEqual(custom);
  });

  // Mutation: drop the colour check, and a stored "red" reaches MapLibre,
  // which then draws no slope at all.
  it("refuses bands the editor would not accept", () => {
    expect(parseSlopeBands(custom)).toEqual(custom);
    expect(parseSlopeBands([{ ...custom[0], colour: "red" }])).toBeNull();
    expect(parseSlopeBands([custom[1], custom[0]])).toBeNull();
    expect(parseSlopeBands([])).toBeNull();
    expect(parseSlopeBands([null])).toBeNull();
    expect(parseSlopeBands("40-50")).toBeNull();
    expect(parseSlopeBands([{ ...custom[0], extra: "x" }, custom[1]])).toEqual(
      custom,
    );
  });
});
