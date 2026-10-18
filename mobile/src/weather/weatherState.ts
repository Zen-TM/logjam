// What the weather view says, decided apart from drawing it so the offline
// and out-of-date cases can be tested.
import {
  WEATHER,
  weatherDaysFrom,
  type WeatherDay,
  type WeatherForecast,
} from "@logjam/shared";

import type { WeatherStatus } from "./useWeather";

export type WeatherViewState =
  | { kind: "loading" }
  | { kind: "failed"; canRetry: boolean }
  | { kind: "needsConnection" }
  | { kind: "outOfDate"; forecast: WeatherForecast }
  | { kind: "forecast"; forecast: WeatherForecast; days: WeatherDay[] };

export function weatherViewState(input: {
  forecast: WeatherForecast | null;
  status: WeatherStatus;
  canFetch: boolean;
  now: number;
}): WeatherViewState {
  const { forecast, status, canFetch, now } = input;
  if (!forecast) {
    if (status === "loading") return { kind: "loading" };
    if (status === "failed") return { kind: "failed", canRetry: canFetch };
    return canFetch ? { kind: "loading" } : { kind: "needsConnection" };
  }
  const days = weatherDaysFrom(forecast, now);
  return days.length === 0
    ? { kind: "outOfDate", forecast }
    : { kind: "forecast", forecast, days };
}

/**
 * The "Show the weather here" row: dead only when pressing could show
 * nothing, which is offline with no kept forecast (shared/DESIGN.md §5).
 */
export function showWeatherRow(input: {
  forecast: WeatherForecast | null;
  canFetch: boolean;
}): { disabled: boolean; reason: string | undefined } {
  const disabled = !input.canFetch && input.forecast === null;
  return {
    disabled,
    reason: disabled ? WEATHER.copy.needsConnection : undefined,
  };
}

/**
 * Whether a press may send a request. "Simulating offline mode" is read again
 * at the press: a place page kept mounted in another tab has not re-rendered
 * since the switch moved.
 */
export function mayFetch(input: {
  canFetch: boolean;
  offlineOnlyNow: boolean;
}): boolean {
  return input.canFetch && !input.offlineOnlyNow;
}
