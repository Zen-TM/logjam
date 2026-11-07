import { MAP_INK, ROUTE_ARROW_IMAGE, WEATHER_MAP } from "@logjam/shared";
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

  // Mutation: align the icon to the viewport, or let overlap in, and the
  // arrows turn with the map or pile up when zoomed out.
  it("turns each arrow to where the wind blows and lets MapLibre thin them", () => {
    expect(WEATHER_ARROW_STYLE).toMatchObject({
      iconImage: ROUTE_ARROW_IMAGE,
      iconRotate: ["get", "rotate"],
      iconRotationAlignment: "map",
      iconAllowOverlap: false,
      iconColor: MAP_INK.casing,
    });
  });

  it("has no arrows until the wind file is in", () => {
    expect(weatherArrowData(null, 0).features).toEqual([]);
    const wind = {
      west: 139,
      north: -26,
      step: 0.5,
      columns: 1,
      rows: 1,
      steps: [{ speed: [20], from: [270] }],
    };
    expect(weatherArrowData(wind, 0).features).toHaveLength(1);
  });
});
