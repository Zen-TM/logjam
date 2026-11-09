import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseWeatherMap,
  WEATHER_LAYERS,
  WEATHER_MAP,
  weatherLayer,
  weatherLayerUrl,
  weatherLegendRows,
  weatherReliefColor,
  weatherShownLabel,
  weatherStepAt,
  weatherTimeLabel,
  weatherWindUrl,
  type WeatherWindFile,
  windArrows,
} from "./weatherMap.js";

// Written by topo/tests/test_weather.py from the builder itself: this reads
// what the job writes.
const readFixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "__fixtures__", name), "utf8"),
  );
const file = parseWeatherMap(readFixture("weather-latest.json"))!;
const wind = readFixture("weather-wind.json") as WeatherWindFile;
const BASE = "https://cdn.example";

/** The colour a `color-relief` expression gives a value: its linear rule. */
function reliefAt(expression: unknown[], value: number): string {
  const stops = expression.slice(3) as (number | string)[];
  let at = stops[1] as string;
  for (let i = 0; i < stops.length; i += 2)
    if (value >= (stops[i] as number)) at = stops[i + 1] as string;
  return at;
}

describe("the weather map's manifest", () => {
  // Mutation: rename or drop a manifest field on either side, or bump the
  // format on one, and the parse comes back null.
  it("reads the file the builder writes", () => {
    expect(file).not.toBeNull();
    expect(file.model).toBe("ecmwf_ifs");
    expect(file.steps[0]).toEqual({ time: file.anchor, hours: 1 });
    expect(file.totals).toEqual([
      "rainPast168",
      "rainPast72",
      "rainPast24",
      "rainNext24",
      "rainNext72",
    ]);
  });

  // Mutation: drop the folder pattern and a manifest could point a client at
  // any path on the CDN.
  it("refuses a manifest it can't draw", () => {
    const raw = readFixture("weather-latest.json") as Record<string, unknown>;
    expect(parseWeatherMap({ ...raw, format: 2 })).toBeNull();
    expect(parseWeatherMap({ ...raw, path: "../gauges/" })).toBeNull();
    expect(parseWeatherMap({ ...raw, steps: [] })).toBeNull();
    expect(parseWeatherMap({ ...raw, totals: ["rainNext999"] })).toBeNull();
    expect(parseWeatherMap(null)).toBeNull();
  });

  // Mutation: name a step without its zero padding, a total under the
  // fields, or a step past the run, and a client asks for a file the job
  // never wrote.
  it("names each layer's archive under the run's folder", () => {
    const folder = `${BASE}/${WEATHER_MAP.prefix}${file.path}`;
    expect(weatherLayerUrl(`${BASE}/`, file, "rain", 7)).toBe(
      `${folder}rain/007.pmtiles`,
    );
    expect(weatherLayerUrl(BASE, file, "rainPast24", 7)).toBe(
      `${folder}totals/rainPast24.pmtiles`,
    );
    expect(weatherLayerUrl(BASE, file, "rain", file.steps.length)).toBeNull();
    expect(
      weatherLayerUrl(BASE, { ...file, totals: [] }, "rainPast24", 0),
    ).toBeNull();
    expect(weatherWindUrl(BASE, file)).toBe(`${folder}wind.json`);
  });
});

describe("the slider", () => {
  const anchor = Date.parse(file.anchor);

  it("starts at the step now falls in", () => {
    expect(weatherStepAt(file, anchor + 30 * 60_000)).toBe(1);
    expect(weatherStepAt(file, anchor - 3 * 3_600_000)).toBe(0);
  });

  // Mutation: fall back to the last step and a run a week old draws as now.
  it("has no step once every one is past", () => {
    const last = Date.parse(file.steps.at(-1)!.time);
    expect(weatherStepAt(file, last + 3_600_000)).toBeNull();
  });

  it("says when a step is, on this device's clock", () => {
    const at = new Date(2026, 10, 8, 14);
    expect(weatherTimeLabel(at.toISOString(), at.getTime())).toBe(
      "Today, 2 pm",
    );
    expect(weatherTimeLabel(at.toISOString(), at.getTime() - 86_400_000)).toBe(
      "Sun 8, 2 pm",
    );
    expect(
      weatherTimeLabel(new Date(2026, 10, 8, 0).toISOString(), at.getTime()),
    ).toBe("Today, 12 am");
  });

  it("says a total's window by where it ends", () => {
    const now = anchor;
    expect(weatherShownLabel(file, "rainPast24", 0, now)).toBe(
      `To ${weatherTimeLabel(file.anchor, now)}`,
    );
    expect(weatherShownLabel(file, "rainNext24", 0, now)).toBe(
      `To ${weatherTimeLabel(new Date(anchor + 86_400_000).toISOString(), now)}`,
    );
    expect(weatherShownLabel(file, "rain", 2, now)).toBe(
      weatherTimeLabel(file.steps[2]!.time, now),
    );
  });
});

describe("the colours", () => {
  // Mutation: drop temperature's clear first stop and the tile's no-value
  // pixels (−32768) paint the coldest blue.
  it("leaves no value clear for every layer", () => {
    for (const layer of WEATHER_LAYERS)
      expect(reliefAt(weatherReliefColor(layer.key), -32768)).toBe(
        "rgba(0,0,0,0.000)",
      );
  });

  it("leaves a dry or calm map clear", () => {
    expect(reliefAt(weatherReliefColor("rain"), 0)).toBe("rgba(0,0,0,0.000)");
    expect(reliefAt(weatherReliefColor("rainPast168"), 0.2)).toBe(
      "rgba(0,0,0,0.000)",
    );
    expect(reliefAt(weatherReliefColor("wind"), 3)).toBe("rgba(0,0,0,0.000)");
  });

  // Mutation: put two stops out of order or on one value, and MapLibre
  // refuses the whole expression and draws nothing.
  it("interpolates stops in rising order", () => {
    for (const layer of WEATHER_LAYERS) {
      const values = layer.stops.map((s) => s.value);
      expect(values).toEqual([...values].sort((a, b) => a - b));
      expect(new Set(values).size).toBe(values.length);
    }
  });

  // Mutation: list an unlabelled stop, or a translucent colour, and the key
  // shows a row the map has no band for, or a swatch the sheet swallows.
  it("keys the legend by each labelled stop, opaque", () => {
    const rows = weatherLegendRows("rain");
    expect(rows.map((r) => r.label)).toEqual([
      "0.2 mm/h",
      "1 mm/h",
      "3 mm/h",
      "8 mm/h",
      "20 mm/h",
    ]);
    for (const row of rows) expect(row.colour).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("falls back to rain for a stored layer it doesn't know", () => {
    expect(weatherLayer("snow").key).toBe("rain");
  });
});

describe("the wind arrows", () => {
  // Mutation: count rows from the south, or turn the arrow to `from`
  // instead of downwind, and every arrow points the wrong way.
  it("places each point from the north-west and turns it downwind", () => {
    const { features } = windArrows(wind, 0);
    expect(features).toHaveLength(wind.rows * wind.columns);
    expect(features[0]!.geometry.coordinates).toEqual([wind.west, wind.north]);
    expect(features[wind.columns]!.geometry.coordinates).toEqual([
      wind.west,
      wind.north - wind.step,
    ]);
    // The fixture's wind is from the west (270°): the arrowhead, drawn
    // pointing east, keeps pointing east.
    expect(features[0]!.properties).toEqual({ speed: 18, rotate: 0 });
  });

  // Mutation: draw a null as 0, and a point with no forecast shows calm.
  it("leaves out a point with no value, and a step that isn't there", () => {
    const gappy: WeatherWindFile = {
      ...wind,
      steps: [
        {
          speed: wind.steps[0]!.speed.map((s, i) => (i === 0 ? null : s)),
          from: wind.steps[0]!.from,
        },
      ],
    };
    expect(windArrows(gappy, 0).features).toHaveLength(
      wind.rows * wind.columns - 1,
    );
    expect(windArrows(wind, 99).features).toEqual([]);
  });
});
