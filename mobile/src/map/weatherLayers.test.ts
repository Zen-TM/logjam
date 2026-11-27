import { MAP_INK, WEATHER_MAP, WIND_ARROW_IMAGE } from "@logjam/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { weatherFixture as file } from "../weatherMap/weatherMapFixture";
import {
  WEATHER_ARROW_STYLE,
  weatherArrowData,
  weatherFieldLayerId,
  weatherFieldPaint,
  weatherSource,
} from "./weatherLayers";

describe("weatherSource", () => {
  // Mutation: key the source by the layer alone, and a step change keeps the
  // old archive on screen (MLRN freezes a source's url while its key holds).
  it("is a new source for each step and each layer", () => {
    const keys = [
      weatherSource("https://cdn.example", file, "rain", 0)?.key,
      weatherSource("https://cdn.example", file, "rain", 1)?.key,
      weatherSource("https://cdn.example", file, "wind", 0)?.key,
    ];
    expect(new Set(keys).size).toBe(3);
    expect(weatherFieldLayerId(keys[0]!)).not.toBe(
      weatherFieldLayerId(keys[1]!),
    );
  });

  it("reads the archive through the pmtiles protocol, as a terrarium field", () => {
    expect(weatherSource("https://cdn.example", file, "rain", 2)).toMatchObject(
      {
        status: "ok",
        sourceType: "raster-dem",
        url: "pmtiles://https://cdn.example/master/weather/v1/runs/20261107T0000Z-20261107T0900Z/rain/002.pmtiles",
        origin: "remote",
      },
    );
  });

  // Mutation: mark a kept file remote, and offline reads of the phone's own
  // run are treated as CDN reads.
  it("marks the phone's own copy local", () => {
    const kept = weatherSource(
      "file:///data/weather-map",
      file,
      "rainNext24",
      0,
    );
    expect(kept).toMatchObject({ origin: "local" });
    expect(kept?.url).toBe(
      "pmtiles://file:///data/weather-map/master/weather/v1/runs/20261107T0000Z-20261107T0900Z/totals/rainNext24.pmtiles",
    );
  });

  // Mutation: drop the attribution, and the map draws weather with no credit
  // in "Map data" (CC BY 4.0's condition).
  it("carries Open-Meteo's credit", () => {
    expect(
      weatherSource("https://cdn.example", file, "rain", 0)?.attribution,
    ).toBe(WEATHER_MAP.credit);
  });

  it("draws nothing for a total the run does not have or a step it does not have", () => {
    expect(
      weatherSource("https://cdn.example", file, "rainPast72", 0),
    ).toBeNull();
    expect(weatherSource("https://cdn.example", file, "rain", 99)).toBeNull();
  });
});

describe("the field and its arrows", () => {
  // Mutation: set the layer's opacity below 1, and light rain, whose alpha is
  // already in its colour stops, is drawn twice as faint.
  it("paints opaque, with the layer's own colours", () => {
    const paint = weatherFieldPaint("temperature");
    expect(paint["color-relief-opacity"]).toBe(1);
    expect(paint["color-relief-color"][0]).toBe("interpolate");
  });

  // Mutation: align the icon to the viewport, or let the arrows collide or
  // block placement, and they turn with the map or knock out a town's name.
  it("turns each arrow to where the wind blows, and hides no label", () => {
    expect(WEATHER_ARROW_STYLE).toMatchObject({
      iconImage: WIND_ARROW_IMAGE,
      iconRotate: ["get", "rotate"],
      iconRotationAlignment: "map",
      iconAllowOverlap: true,
      iconIgnorePlacement: true,
      iconColor: MAP_INK.casing,
    });
  });

  const wind = {
    west: 139,
    north: -26,
    step: 0.5,
    columns: 3,
    rows: 3,
    steps: [{ speed: Array(9).fill(20), from: Array(9).fill(270) }],
  };
  const bounds = { west: 138, south: -28, east: 141, north: -25 };

  // Mutation: ignore the view, and the arrows stay the grid's own however
  // far the map zooms; draw before the first settle, and the arrows land
  // where no view says they should.
  it("has no arrows until the wind file and a settled view are in", () => {
    expect(weatherArrowData(null, 0, { bounds, zoom: 7 }).features).toEqual([]);
    expect(weatherArrowData(wind, 0, null).features).toEqual([]);
    expect(
      weatherArrowData(wind, 0, { bounds, zoom: 7 }).features,
    ).toHaveLength(9);
    expect(
      weatherArrowData(wind, 0, { bounds, zoom: 9 }).features.length,
    ).toBeGreaterThan(9);
  });
});

// The rain totals are one chip on the layer picker and a rail of periods on
// the card, both from shared; this client has no render tests, so the wiring
// is read from source. Mutation: build the sheet's chips from `options` alone
// (no `overlayChoiceOption`/`overlayChoicePick`), or the card's rail from its
// own list, and a stored total shows no chip selected, or the periods drift
// from Logjam Web's.
describe("the weather picker and card", () => {
  const source = (file: string) => readFileSync(join(__dirname, file), "utf8");
  it("draw their chips from shared", () => {
    const sheet = source("MapLayersSheet.tsx");
    expect(sheet).toContain("overlayChoiceOption(legend, choice.value)");
    expect(sheet).toContain("overlayChoicePick(");
    expect(sheet).toContain("choice.available");
    // The card's rail: one line (`scroll`), only on a total, named from shared,
    // its periods from the run's totals. Mutation: drop any of the four, and
    // the card wraps, grows a rail on a stepped layer, has an unnamed group,
    // or offers a period the run lacks.
    const bar = source("WeatherBar.tsx");
    expect(bar).toContain("isWeatherTotal(weatherLayer(layer))");
    expect(bar).toMatch(/<ChipRail<WeatherTotalKey>\s+scroll\b/);
    expect(bar).toContain("label={copy.weatherPeriod}");
    expect(bar).toContain("weatherPeriodOptions(totals)");
  });
});
