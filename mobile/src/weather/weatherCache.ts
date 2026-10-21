// The last forecast for each cell, as the one small file Logjam GPS keeps
// (ADR 0038). Pure: `weatherStorage.ts` reads and writes the file.
import { weatherCellKey, type WeatherForecast } from "@logjam/shared";

/** Cells kept; the oldest by `fetchedAt` go first. */
export const WEATHER_CACHE_CELLS = 50;

export type WeatherCache = Record<string, WeatherForecast>;

function isForecast(value: unknown): value is WeatherForecast {
  const f = value as WeatherForecast | null;
  return (
    typeof f === "object" &&
    f !== null &&
    typeof f.fetchedAt === "number" &&
    typeof f.pastRainMm === "number" &&
    typeof f.cell?.latitude === "number" &&
    typeof f.cell?.longitude === "number" &&
    (f.cell.elevationM === null || typeof f.cell.elevationM === "number") &&
    Array.isArray(f.days) &&
    f.days.every(
      (day) =>
        typeof day?.date === "string" &&
        typeof day.code === "number" &&
        typeof day.tempMaxC === "number" &&
        typeof day.tempMinC === "number" &&
        typeof day.rainMm === "number" &&
        typeof day.windMaxKmh === "number" &&
        (day.rainChance === null || typeof day.rainChance === "number"),
    )
  );
}

/** The file's text as a cache; anything malformed reads as empty. */
export function parseWeatherCache(text: string | null): WeatherCache {
  try {
    const raw = JSON.parse(text ?? "") as Record<string, unknown>;
    const cache: WeatherCache = {};
    for (const [key, value] of Object.entries(raw)) {
      if (isForecast(value) && weatherCellKey(value.cell) === key)
        cache[key] = value;
    }
    return cache;
  } catch {
    return {};
  }
}

/** The cache with this forecast in it, newest `WEATHER_CACHE_CELLS` kept. */
export function withForecast(
  cache: WeatherCache,
  forecast: WeatherForecast,
): WeatherCache {
  const entries = Object.entries({
    ...cache,
    [weatherCellKey(forecast.cell)]: forecast,
  })
    .sort(([, a], [, b]) => b.fetchedAt - a.fetchedAt)
    .slice(0, WEATHER_CACHE_CELLS);
  return Object.fromEntries(entries);
}
