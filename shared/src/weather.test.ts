import { afterEach, describe, expect, it, vi } from "vitest";

import forecastJson from "./__fixtures__/openMeteoForecast.json" with {
  type: "json",
};
import {
  WEATHER,
  weatherAge,
  weatherCondition,
  weatherDayFacts,
  weatherDaysFrom,
  weatherRows,
} from "./contracts/weather.js";
import {
  WEATHER_MODELS,
  WEATHER_MODEL_DEFAULT,
  fetchForecast,
  isWeatherModelId,
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
// 09:00 in the fixture's own zone (UTC+11), whichever calendar the test runs in.
const spotNine = Date.UTC(2026, 9, 17, 22);

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

  // ADR 0038: the same cell and height, adding only what the hourly row needs.
  // Mutation that turns it red: add a parameter other than `hourly` for the
  // rows (a `models`, a `minutely_15`), or send `forecast_hours` with the spot.
  it("asks for the hourly fields and nothing else new", () => {
    const params = [...new URL(weatherRequestUrl(cell)).searchParams.keys()];
    expect(params.sort()).toEqual(
      [
        "daily",
        "elevation",
        "forecast_days",
        "hourly",
        "latitude",
        "longitude",
        "past_days",
        "timezone",
      ].sort(),
    );
    expect(new URL(weatherRequestUrl(cell)).searchParams.get("past_days")).toBe(
      "7",
    );
  });

  it("leaves the height to Open-Meteo when it isn't known", () => {
    const url = new URL(weatherRequestUrl(weatherCell(spot, null)));
    expect(url.searchParams.has("elevation")).toBe(false);
  });
});

describe("the forecast model", () => {
  // Mutation that turns it red: set `models` for best match too, or drop the
  // model from `weatherRequestUrl`.
  it("asks for a chosen model by id, and changes nothing else", () => {
    const base = new URL(weatherRequestUrl(cell));
    expect(base.searchParams.has("models")).toBe(false);
    for (const { id } of WEATHER_MODELS) {
      const url = new URL(weatherRequestUrl(weatherCell(spot, 1013.4, id)));
      if (id === WEATHER_MODEL_DEFAULT) {
        expect(url.search).toBe(base.search);
        continue;
      }
      expect(url.searchParams.get("models")).toBe(id);
      url.searchParams.delete("models");
      expect(url.search).toBe(base.search);
    }
  });

  // Mutation that turns it red: leave the model out of `weatherCellKey`, so a
  // client shows one model's forecast under another's name.
  it("keeps each model's forecast under its own key", () => {
    const keys = WEATHER_MODELS.map(({ id }) =>
      weatherCellKey(weatherCell(spot, 1013.4, id)),
    );
    expect(new Set(keys).size).toBe(WEATHER_MODELS.length);
    // A copy kept before models were offered is best match.
    expect(keys[0]).toBe("-33.7,150.3,1010");
  });

  it("lists the default first, once per id, and knows its own", () => {
    expect(WEATHER_MODELS[0].id).toBe(WEATHER_MODEL_DEFAULT);
    const ids = WEATHER_MODELS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isWeatherModelId)).toBe(true);
    expect(isWeatherModelId("bom_access_global")).toBe(false);
    expect(isWeatherModelId(undefined)).toBe(false);
  });
});

describe("parseForecast", () => {
  it("splits what has fallen from what is coming", () => {
    const forecast = parseForecast(forecastJson, cell, now);
    expect(forecast.past.source).toBe("model");
    expect(forecast.past.days.map((day) => day.date)).toEqual([
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
    ]);
    expect(
      forecast.past.days.reduce((sum, day) => sum + day.rainMm, 0),
    ).toBeCloseTo(24.9);
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

  it("keeps the hours from the one it was fetched in, in the spot's own zone", () => {
    const forecast = parseForecast(forecastJson, cell, spotNine + 20 * 60_000);
    expect(forecast.hours).toHaveLength(48);
    expect(forecast.hours[0]).toMatchObject({
      time: "2026-10-18T09:00",
      at: spotNine,
      code: 0,
    });
    expect(forecast.hours[47].time).toBe("2026-10-20T08:00");
  });

  it("refuses an answer that isn't a forecast", () => {
    expect(() => parseForecast({ error: true }, cell, now)).toThrow();
    expect(() =>
      parseForecast(
        {
          ...forecastJson,
          daily: { ...forecastJson.daily, weather_code: [0] },
        },
        cell,
        now,
      ),
    ).toThrow();
    expect(() =>
      parseForecast({ daily: forecastJson.daily }, cell, now),
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
      temperature: "4–17°C",
      rain: "–",
      chance: "5%",
      wind: "10\u00a0km/h",
    });
    expect(weatherDayFacts(forecast.days[1], now)).toMatchObject({
      day: "Mon 19",
      rain: "0.4\u00a0mm",
      chance: "20%",
    });
    expect(weatherDayFacts(forecast.days[5], now).temperature).toBe("-1–8°C");
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

describe("weatherRows", () => {
  const forecast = parseForecast(forecastJson, cell, spotNine);
  const rows = weatherRows(forecast, spotNine);
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));

  // The rows follow the contract's sections, so a client that draws sections
  // in order draws the rows in order. Mutation that turns it red: reorder the
  // rows in `weatherRows`, or add a section to `WEATHER.sections` with no row.
  it("are the contract's sections, in its order", () => {
    expect(rows.map((row) => row.key)).toEqual(
      WEATHER.sections.map(({ key }) => key).filter((key) => key !== "credit"),
    );
  });

  it("draws the next 24 hours from the hour the forecast is read in", () => {
    const hours = byKey.hours.cards;
    expect(hours).toHaveLength(24);
    expect(hours[0]).toMatchObject({
      label: "Now",
      current: true,
      temperature: "9°",
    });
    expect(hours[1].label).toBe("10 am");
    expect(hours[2]).toMatchObject({ label: "11 am", chance: "1%" });
    expect(hours[3]).toMatchObject({ label: "12 pm", chance: "5%" });
    expect(hours.filter((h) => h.current)).toHaveLength(1);
  });

  // The card that opens a new date says the day, so tonight is not mistaken
  // for tomorrow morning. Mutation that turns it red: label it `hourLabel`
  // whatever its date.
  it("labels the first hour of a new date with its day", () => {
    const hours = byKey.hours.cards;
    expect(hours[14].label).toBe("11 pm");
    expect(hours[15].label).toBe("Mon 19");
    expect(hours[15].spoken).toMatch(/^Mon 19, 12 am, /);
    expect(
      hours.filter((h) => /^[A-Z][a-z]{2} \d+$/.test(h.label)),
    ).toHaveLength(1);
  });

  it("draws none as a dash, so the wet cards stand out", () => {
    const [now0] = byKey.hours.cards;
    expect(now0).toMatchObject({ rain: "–", rainLevel: 0 });
    const wet = byKey.days.cards.find((d) => d.rain !== "–");
    expect(wet?.rain).toMatch(/mm$/);
    expect(now0.spoken).toContain("no rain");
    expect(byKey.past.cards[1]).toMatchObject({ rain: "–" });
    // A trace too small to read as 0.1 is none, not "0.0 mm".
    const trace = parseForecast(
      {
        ...forecastJson,
        hourly: {
          ...forecastJson.hourly,
          precipitation: forecastJson.hourly.precipitation.map(() => 0.04),
        },
      },
      cell,
      spotNine,
    );
    expect(weatherRows(trace, spotNine)[0].cards[0].rain).toBe("–");
  });

  // A kept copy read late has fewer than 24 hours left: the title says how
  // many, and the row goes when none remain. Mutation that turns it red: use
  // `WEATHER.copy.hours` whatever the count.
  it("titles the hours a stale copy has left, and drops the row at none", () => {
    const late = weatherRows(forecast, spotNine + 30 * 3_600_000);
    expect(late[0].title).toBe("Next 18 hours");
    expect(late[0].cards).toHaveLength(18);
    const last = weatherRows(forecast, spotNine + 47 * 3_600_000);
    expect(last[0].title).toBe("Next 1 hour");
    expect(
      weatherRows(forecast, spotNine + 49 * 3_600_000).map((r) => r.key),
    ).toEqual(["days", "past"]);
  });

  it("starts the hours at the next one when the read is between two", () => {
    const later = weatherRows(forecast, spotNine + 40 * 60_000);
    expect(later[0].cards[0]).toMatchObject({ label: "Now", current: true });
    const next = weatherRows(forecast, spotNine + 61 * 60_000);
    expect(next[0].cards[0]).toMatchObject({ label: "Now", current: true });
    expect(next[0].cards[0].key).toBe("2026-10-18T10:00");
  });

  it("names the past row for its source and totals it", () => {
    expect(byKey.past.title).toBe("Modelled rain, past 7 days");
    // Mutation: a plain space in formatRainMm lets a narrow card or a large
    // font strand the unit on its own line.
    expect(byKey.past.summary).toBe("25\u00a0mm");
    expect(byKey.past.cards).toHaveLength(7);
    expect(byKey.past.cards[0]).toMatchObject({
      label: "Sun 11",
      rain: "7\u00a0mm",
      glyph: null,
      temperature: null,
      wind: null,
    });
    const gauged = weatherRows(
      { ...forecast, past: { ...forecast.past, source: "gauge" } },
      spotNine,
    );
    expect(gauged[2].title).toBe("Rain gauge, past 7 days");
  });

  // A bar reads against its row, with a floor so a drizzle isn't a downpour.
  // Mutation that turns it red: drop the `RAIN_FULL_MM` floor from `rainLevels`.
  it("scales rain bars to the row, leaving a dry card empty", () => {
    const past = byKey.past.cards;
    expect(past[0].rainLevel).toBeCloseTo(7.4 / 20);
    expect(past[1].rainLevel).toBe(0);
    const wet = weatherRows(
      {
        ...forecast,
        past: {
          ...forecast.past,
          days: [{ date: "2026-10-17", rainMm: 60 }],
        },
      },
      spotNine,
    );
    expect(wet[2].cards[0].rainLevel).toBe(1);
  });

  it("leaves out a row with nothing left in it", () => {
    const much = weatherRows(forecast, Date.UTC(2027, 0, 1));
    expect(much.map((row) => row.key)).toEqual(["past"]);
  });

  it("reads a card aloud with every figure on it", () => {
    expect(byKey.hours.cards[5].spoken).toBe(
      "2 pm, Clear, 16°, no rain, 5% chance, wind 8\u00a0km/h",
    );
    expect(byKey.past.cards[0].spoken).toBe("Sun 11, rain 7\u00a0mm");
  });
});

// The hourly array spans a fortnight, so one UTC offset for all of it is an
// hour out on the far side of a daylight-saving change. Sydney went from +10
// to +11 at 02:00 on 2026-10-04. Mutation that turns it red: build `at` from
// `utc_offset_seconds` alone, as before.
describe("hours across a daylight-saving change", () => {
  const times = Array.from({ length: 72 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 3, i));
    return d.toISOString().slice(0, 13) + ":00";
  }).filter((t) => t !== "2026-10-04T02:00"); // the hour that did not happen
  const flat = (v: number) => times.map(() => v);
  const json = {
    ...forecastJson,
    utc_offset_seconds: 39600,
    hourly: {
      time: times,
      weather_code: flat(0),
      temperature_2m: flat(10),
      precipitation: flat(0),
      precipitation_probability: flat(0),
      wind_speed_10m: flat(5),
    },
  };
  const parsed = parseForecast(json, cell, Date.UTC(2026, 9, 2, 12));
  const at = (time: string) => parsed.hours.find((h) => h.time === time)?.at;

  it("takes each hour's offset from the zone's rules", () => {
    expect(at("2026-10-04T01:00")).toBe(Date.UTC(2026, 9, 3, 15)); // +10
    expect(at("2026-10-04T03:00")).toBe(Date.UTC(2026, 9, 3, 16)); // +11
    expect(at("2026-10-04T20:00")).toBe(Date.UTC(2026, 9, 4, 9)); // +11
  });

  it("falls back to the response's offset without a zone", () => {
    const { timezone: _zone, ...noZone } = json;
    const hour = parseForecast(noZone, cell, Date.UTC(2026, 9, 2, 12)).hours[0];
    expect(hour.at).toBe(Date.UTC(2026, 9, 3, 0) - 39600_000);
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
