import { afterEach, describe, expect, it, vi } from "vitest";

import forecastJson from "./__fixtures__/openMeteoForecast.json" with {
  type: "json",
};
import {
  weatherAge,
  weatherCondition,
  weatherDayFacts,
  weatherDaysFrom,
} from "./contracts/weather.js";
import {
  fetchForecast,
  parseForecast,
  weatherCell,
  weatherCellKey,
  weatherRequestUrl,
} from "./weather.js";

// A made-up forecast for the cell around Katoomba, a published town.
const spot = { latitude: -33.71234, longitude: 150.31188 };
const cell = weatherCell(spot, 1013.4);
// 09:00 on 2026-10-18 on whatever calendar the test runs in.
const now = new Date(2026, 9, 18, 9).getTime();

describe("weatherCell", () => {
  // The privacy boundary of ADR 0038. Mutation that turns it red: return
  // `point.latitude` unrounded from `weatherCell`, or set `elevation` from the
  // height as given.
  it("sends only the cell, never the spot", () => {
    const url = new URL(weatherRequestUrl(cell));
    expect(url.origin + url.pathname).toBe(
      "https://api.open-meteo.com/v1/forecast",
    );
    expect(url.searchParams.get("latitude")).toBe("-33.7");
    expect(url.searchParams.get("longitude")).toBe("150.3");
    expect(url.searchParams.get("elevation")).toBe("1010");
    // No figure finer than the cell, anywhere in the request.
    expect(url.search).not.toMatch(/\d\.\d{2,}/);
    expect(url.search).not.toContain("71234");
    expect(url.search).not.toContain("31188");
  });

  it("gives every spot in a cell the same request", () => {
    const a = weatherCell({ latitude: -33.66, longitude: 150.26 }, 1006);
    const b = weatherCell({ latitude: -33.74, longitude: 150.34 }, 1008);
    expect(weatherRequestUrl(a)).toBe(weatherRequestUrl(b));
    expect(weatherCellKey(a)).toBe(weatherCellKey(b));
  });

  it("leaves the height to Open-Meteo when it isn't known", () => {
    const url = new URL(weatherRequestUrl(weatherCell(spot, null)));
    expect(url.searchParams.has("elevation")).toBe(false);
  });
});

describe("parseForecast", () => {
  it("splits what has fallen from what is coming", () => {
    const forecast = parseForecast(forecastJson, cell, now);
    expect(forecast.pastRainMm).toBeCloseTo(17.3);
    expect(forecast.days.map((day) => day.date)).toEqual([
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
    ]);
    expect(forecast.days[0]).toEqual({
      date: "2026-10-18",
      code: 0,
      tempMaxC: 16.6,
      tempMinC: 3.9,
      rainMm: 0,
      rainChance: 5,
      windMaxKmh: 9.6,
    });
  });

  it("refuses an answer that isn't a forecast", () => {
    expect(() => parseForecast({ error: true }, cell, now)).toThrow();
    expect(() =>
      parseForecast(
        { daily: { ...forecastJson.daily, weather_code: [0] } },
        cell,
        now,
      ),
    ).toThrow();
  });
});

describe("fetchForecast", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Errors reach logs and crash reports. Mutation: put the URL in the message.
  it("fails without naming the cell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    const error = await fetchForecast(cell).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/33|150/);
  });

  it("stamps the forecast with when it was fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(forecastJson)),
    );
    const forecast = await fetchForecast(cell, { now: () => now });
    expect(forecast.fetchedAt).toBe(now);
    expect(forecast.cell).toEqual(cell);
  });
});

describe("weatherDayFacts", () => {
  const forecast = parseForecast(forecastJson, cell, now);

  it("draws a day in the words both clients use", () => {
    expect(weatherDayFacts(forecast.days[0], now)).toEqual({
      date: "2026-10-18",
      day: "Today",
      condition: { label: "Clear", icon: "weatherClear" },
      temperature: "4–17°",
      rain: "0 mm · 5%",
      wind: "10 km/h",
    });
    expect(weatherDayFacts(forecast.days[1], now)).toMatchObject({
      day: "Mon 19",
      rain: "0.4 mm · 20%",
    });
    expect(weatherDayFacts(forecast.days[5], now).temperature).toBe("-1–8°");
  });

  it("drops the days a kept forecast has outlived", () => {
    const later = new Date(2026, 9, 21, 7).getTime();
    expect(weatherDaysFrom(forecast, later).map((day) => day.date)[0]).toBe(
      "2026-10-21",
    );
    const muchLater = new Date(2026, 10, 1).getTime();
    expect(weatherDaysFrom(forecast, muchLater)).toEqual([]);
  });
});

describe("weatherCondition", () => {
  it.each([
    [0, "weatherClear"],
    [2, "weatherPartCloud"],
    [3, "weatherCloud"],
    [48, "weatherFog"],
    [55, "weatherDrizzle"],
    [63, "weatherRain"],
    [81, "weatherRain"],
    [75, "weatherSnow"],
    [99, "weatherStorm"],
  ])("draws WMO %i as %s", (code, icon) => {
    expect(weatherCondition(code).icon).toBe(icon);
  });
});

describe("weatherAge", () => {
  it.each([
    [30_000, "Updated just now"],
    [14 * 60_000, "Updated 14 min ago"],
    [5 * 3_600_000, "Updated 5 h ago"],
    [30 * 3_600_000, "Updated 1 day ago"],
    [50 * 3_600_000, "Updated 2 days ago"],
  ])("after %i ms says %s", (elapsed, words) => {
    expect(weatherAge(now - elapsed, now)).toBe(words);
  });
});
