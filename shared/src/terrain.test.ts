import { describe, expect, it } from "vitest";

import { NSW_5M } from "./demSources.js";
import {
  NSW_HILLSHADE,
  NSW_SLOPE,
  normalizeTerrainLayers,
  slopeReliefColor,
  TERRAIN_LAYER_DEFAULTS,
  terrainBeforeIds,
} from "./terrain.js";
import { normalizeUserUiPreferences } from "./themeSchemes.js";
import {
  parseSlopeBands,
  RASTER_TEMPLATE_DEFAULTS,
  rgbaCssFromHex,
  type SlopeBand,
} from "./topoSettings.js";

/**
 * The colour MapLibre draws at `degrees` under `interpolate ["linear"]`:
 * clamped outside the stops, a stop's own colour on it, and between two stops
 * of different colours a blend of them.
 */
function colourAt(expression: unknown[], degrees: number): unknown {
  const stops = expression.slice(3);
  const at = (i: number) => stops[i] as number;
  if (degrees <= at(0)) return stops[1];
  for (let i = 0; i + 2 < stops.length; i += 2) {
    if (degrees > at(i + 2)) continue;
    if (degrees === at(i)) return stops[i + 1];
    if (degrees === at(i + 2)) return stops[i + 3];
    return stops[i + 1] === stops[i + 3]
      ? stops[i + 1]
      : `a blend of ${String(stops[i + 1])} and ${String(stops[i + 3])}`;
  }
  return stops[stops.length - 1];
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
    expect(colourAt(expression, 45)).toBe(rgbaCssFromHex(BANDS[0]!.colour));
    expect(colourAt(expression, 49.99)).toBe(rgbaCssFromHex(BANDS[0]!.colour));
    expect(colourAt(expression, 50)).toBe(rgbaCssFromHex(BANDS[1]!.colour));
    expect(colourAt(expression, 90)).toBe(rgbaCssFromHex(BANDS[3]!.colour));
    const stops = expression.slice(3).filter((_, i) => i % 2 === 0);
    expect(stops).toEqual(
      [...stops].sort((a, b) => (a as number) - (b as number)),
    );
  });

  // Mutation: start `below` at the first band's colour, and no-data (−32768)
  // clamps to it wherever a band starts at 0°.
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

describe("terrainBeforeIds", () => {
  /** A style's layer list after moving each layer under its `beforeId`. */
  function stacked(style: string[], moves: [string, string][]): string[] {
    const ids = [...style];
    for (const [id, before] of moves) {
      if (ids.includes(id)) ids.splice(ids.indexOf(id), 1);
      ids.splice(ids.indexOf(before), 0, id);
    }
    return ids;
  }

  // Mutation: anchor the slope apart from the contours (say under `water`, with
  // the shading), and a water fill or a land fill lands between them.
  it("puts the shading over the land and the slope directly under the contours, under the roads", () => {
    const style = [
      "pm-earth",
      "pm-landcover",
      "pm-water",
      "pm-water_stream",
      "pm-roads_minor",
      "pm-places_locality",
    ];
    const moves = terrainBeforeIds(
      {
        contours: ["c-minor", "c-major", "c-labels"],
        slope: ["slope"],
        hillshade: ["shade"],
      },
      (id) => `pm-${id}`,
    );
    expect(stacked(style, moves)).toEqual([
      "pm-earth",
      "pm-landcover",
      "shade",
      "pm-water",
      "slope",
      "c-minor",
      "c-major",
      "c-labels",
      "pm-water_stream",
      "pm-roads_minor",
      "pm-places_locality",
    ]);
  });
});
