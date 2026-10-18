import { describe, expect, it } from "vitest";
import { WEATHER, weatherCell, type WeatherForecast } from "@logjam/shared";

import { showWeatherRow, weatherViewState } from "./weatherState";

const NOW = Date.parse("2026-10-18T12:00:00");
const forecast = (date: string): WeatherForecast => ({
  cell: weatherCell({ latitude: -33.5, longitude: 150.4 }, 600),
  fetchedAt: NOW - 3_600_000,
  pastRainMm: 0,
  days: [
    {
      date,
      code: 0,
      tempMaxC: 20,
      tempMinC: 8,
      rainMm: 0,
      rainChance: 0,
      windMaxKmh: 10,
    },
  ],
});

describe("the Show the weather row", () => {
  // Mutation that turns it red: disable on `!canFetch` alone.
  it("is dead only offline with nothing kept, and says why", () => {
    expect(showWeatherRow({ forecast: null, canFetch: false })).toEqual({
      disabled: true,
      reason: WEATHER.copy.needsConnection,
    });
    expect(showWeatherRow({ forecast: null, canFetch: true }).disabled).toBe(
      false,
    );
    expect(
      showWeatherRow({ forecast: forecast("2026-10-18"), canFetch: false })
        .disabled,
    ).toBe(false);
  });
});

describe("the weather view's state", () => {
  const base = { status: "idle", canFetch: true, now: NOW } as const;

  it("shows a kept forecast offline, with Refresh left to the view", () => {
    const state = weatherViewState({
      ...base,
      canFetch: false,
      forecast: forecast("2026-10-18"),
    });
    expect(state.kind).toBe("forecast");
  });

  it("says it needs a connection offline with nothing kept", () => {
    expect(
      weatherViewState({ ...base, canFetch: false, forecast: null }).kind,
    ).toBe("needsConnection");
  });

  it("offers Try again only online", () => {
    const failed = { ...base, status: "failed", forecast: null } as const;
    expect(weatherViewState(failed)).toEqual({
      kind: "failed",
      canRetry: true,
    });
    expect(weatherViewState({ ...failed, canFetch: false })).toEqual({
      kind: "failed",
      canRetry: false,
    });
  });

  // Mutation that turns it red: skip `weatherDaysFrom` and show the days as kept.
  it("never shows a forecast whose days are all past", () => {
    expect(
      weatherViewState({ ...base, forecast: forecast("2026-10-10") }).kind,
    ).toBe("outOfDate");
  });
});
