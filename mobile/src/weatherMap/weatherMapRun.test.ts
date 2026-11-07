import { describe, expect, it } from "vitest";
import { weatherLayerUrl } from "@logjam/shared";

import { weatherFixture as file } from "./weatherMapFixture";
import {
  areaTouchesRun,
  parseWeatherWind,
  weatherRunUrls,
} from "./weatherMapRun";

describe("weatherRunUrls", () => {
  const urls = weatherRunUrls("https://cdn.example", file);

  // Mutation: list a field's steps from 1, or every total whether or not the
  // run has it, and a kept run lacks a file the overlay asks for, or the
  // download fails on a total the CDN never had.
  it("names each field at each step, each total the run has, and the wind", () => {
    expect(urls).toHaveLength(4 * 4 + 2 + 1);
    expect(urls).toContain(
      "https://cdn.example/master/weather/v1/runs/20261107T0000Z/rain/003.pmtiles",
    );
    expect(urls).toContain(
      "https://cdn.example/master/weather/v1/runs/20261107T0000Z/totals/rainNext24.pmtiles",
    );
    expect(urls.some((u) => u.includes("rainPast72"))).toBe(false);
    expect(urls.at(-1)).toBe(
      "https://cdn.example/master/weather/v1/runs/20261107T0000Z/wind.json",
    );
  });

  // Mutation: build the kept paths another way than the CDN's, and the
  // overlay, which reads `weatherLayerUrl(keptBase, ...)`, finds no file.
  it("lays the kept copy out as the CDN does, file for file", () => {
    const kept = weatherRunUrls("file:///data/weather-map", file);
    expect(kept).toHaveLength(urls.length);
    urls.forEach((url, i) =>
      expect(
        kept[i]!.replace("file:///data/weather-map", "https://cdn.example"),
      ).toBe(url),
    );
    expect(
      weatherLayerUrl("file:///data/weather-map", file, "temperature", 2),
    ).toBe(kept[1 * 4 + 2]);
  });
});

describe("areaTouchesRun", () => {
  // Mutation: return true always, and an area in Perth keeps 12 MB of NSW weather.
  it("keeps weather only for an area the run covers", () => {
    expect(
      areaTouchesRun(
        { west: 150.2, south: -33.7, east: 150.3, north: -33.6 },
        file.bounds,
      ),
    ).toBe(true);
    expect(
      areaTouchesRun(
        { west: 115.8, south: -32, east: 116, north: -31.9 },
        file.bounds,
      ),
    ).toBe(false);
  });
});

describe("parseWeatherWind", () => {
  const wind = {
    west: 139,
    north: -26,
    step: 0.5,
    columns: 2,
    rows: 1,
    steps: [{ speed: [10, null], from: [90, null] }],
  };

  // Mutation: return the parsed JSON as it is, and `windArrows` reads `rows` of
  // a file that has none.
  it("takes the shape windArrows reads and nothing else", () => {
    expect(parseWeatherWind(wind)).toEqual(wind);
    for (const bad of [
      null,
      {},
      { ...wind, steps: [{ speed: 1 }] },
      { ...wind, columns: "2" },
    ])
      expect(parseWeatherWind(bad)).toBeNull();
  });
});
