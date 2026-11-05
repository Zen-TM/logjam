import { describe, expect, it } from "vitest";
import {
  weatherCell,
  weatherCellKey,
  type WeatherForecast,
} from "@logjam/shared";

import {
  WEATHER_CACHE_CELLS,
  parseWeatherCache,
  withForecast,
} from "./weatherCache";

function forecastAt(i: number, fetchedAt: number): WeatherForecast {
  return {
    cell: weatherCell({ latitude: -33 + i / 10, longitude: 150 }, 600),
    fetchedAt,
    hours: [
      {
        time: "2026-10-18T09:00",
        at: 1000,
        code: 3,
        tempC: 9,
        rainMm: 0.2,
        rainChance: null,
        windKmh: 12,
      },
    ],
    past: { source: "model", days: [{ date: "2026-10-17", rainMm: 2 }] },
    days: [
      {
        date: "2026-10-18",
        code: 3,
        tempMaxC: 17,
        tempMinC: 4,
        rainMm: 0,
        rainChance: null,
        windMaxKmh: 20,
      },
    ],
  };
}

describe("the kept forecasts", () => {
  // A copy kept before the rows existed has no hours: reading it as a forecast
  // would draw a hole. Mutation that turns it red: drop the `hours` check from
  // `isForecast`.
  it("reads a forecast kept in the old shape as nothing", () => {
    const f = forecastAt(0, 1000);
    const { hours: _hours, past: _past, ...old } = f;
    const text = JSON.stringify({
      [weatherCellKey(f.cell)]: { ...old, pastRainMm: 2 },
    });
    expect(parseWeatherCache(text)).toEqual({});
  });

  it("round-trips through the file's text", () => {
    const f = forecastAt(0, 1000);
    const text = JSON.stringify(withForecast({}, f));
    expect(parseWeatherCache(text)[weatherCellKey(f.cell)]).toEqual(f);
  });

  // Mutation that turns it red: drop `isForecast` from `parseWeatherCache`
  // (the bad entry then survives under its valid key).
  it("drops a malformed entry and keeps the good ones", () => {
    const good = forecastAt(0, 1000);
    const bad = { ...forecastAt(1, 1000), fetchedAt: "yesterday" };
    const parsed = parseWeatherCache(
      JSON.stringify({
        [weatherCellKey(good.cell)]: good,
        [weatherCellKey(bad.cell)]: bad,
      }),
    );
    expect(Object.keys(parsed)).toEqual([weatherCellKey(good.cell)]);
  });

  // Mutation that turns it red: parse without the try/catch.
  it("reads a malformed file as empty", () => {
    expect(parseWeatherCache(null)).toEqual({});
    expect(parseWeatherCache("{not json")).toEqual({});
    expect(parseWeatherCache("[1,2]")).toEqual({});
    expect(parseWeatherCache('{"x":{"days":"no"}}')).toEqual({});
  });

  it("drops an entry filed under another cell's key", () => {
    const f = forecastAt(0, 1000);
    expect(parseWeatherCache(JSON.stringify({ "0.0,0.0,": f }))).toEqual({});
  });

  // Mutation that turns it red: sort ascending, or drop the slice.
  it("keeps the newest cells and drops the oldest by fetchedAt", () => {
    let cache = {};
    for (let i = 0; i < WEATHER_CACHE_CELLS + 5; i++)
      cache = withForecast(cache, forecastAt(i, 1000 + i));
    const keys = Object.keys(cache);
    expect(keys).toHaveLength(WEATHER_CACHE_CELLS);
    expect(keys).not.toContain(weatherCellKey(forecastAt(0, 0).cell));
    expect(keys).toContain(weatherCellKey(forecastAt(54, 0).cell));
  });

  it("replaces a cell's forecast rather than adding a second", () => {
    const cache = withForecast(
      withForecast({}, forecastAt(0, 1000)),
      forecastAt(0, 2000),
    );
    expect(Object.values(cache).map((f) => f.fetchedAt)).toEqual([2000]);
  });
});
