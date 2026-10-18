// The forecast for a spot, from Open-Meteo's free API (ADR 0038).
//
// PRIVACY: a forecast request is the one place a client sends a position of
// the user's choosing to a third party, so it never sends the position: only
// the 0.1° cell around it (about 11 × 9 km in NSW) and the spot's height to
// the nearest 10 m, which Open-Meteo needs to correct the temperature for
// terrain. Guard: `weather.test.ts` ("sends only the cell"). The request goes
// straight from the client, never through our API: Open-Meteo counts its free
// limits per IP, and one IP for every user would meet them first.
//
// Asked only when the user presses for it: nothing here polls.

export const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
export const OPEN_METEO_CREDIT_URL = "https://open-meteo.com/";

/** The grid a request is snapped to: coarser than every model's own. */
export const WEATHER_CELL_DEGREES = 0.1;
/** The past days whose rain is summed: what a canyon is still draining. */
export const WEATHER_PAST_DAYS = 3;
export const WEATHER_FORECAST_DAYS = 7;

export type WeatherCell = {
  latitude: number;
  longitude: number;
  /** Metres, to the nearest 10, or null where the height isn't known. */
  elevationM: number | null;
};

export type WeatherDay = {
  /** YYYY-MM-DD, in the spot's own time zone. */
  date: string;
  /** WMO weather interpretation code. */
  code: number;
  tempMaxC: number;
  tempMinC: number;
  rainMm: number;
  /** Null for a day already past, which has no probability. */
  rainChance: number | null;
  windMaxKmh: number;
};

export type WeatherForecast = {
  cell: WeatherCell;
  /** Epoch ms. */
  fetchedAt: number;
  /** Rain over the `WEATHER_PAST_DAYS` days before the fetch. */
  pastRainMm: number;
  /** Today (at the fetch) and the days after it. */
  days: WeatherDay[];
};

function snap(degrees: number): number {
  const cells = Math.round(degrees / WEATHER_CELL_DEGREES);
  return Number((cells * WEATHER_CELL_DEGREES).toFixed(1));
}

/** All a forecast request is allowed to know about a spot. */
export function weatherCell(
  point: { latitude: number; longitude: number },
  elevationM: number | null | undefined,
): WeatherCell {
  return {
    latitude: snap(point.latitude),
    longitude: snap(point.longitude),
    elevationM:
      elevationM != null && Number.isFinite(elevationM)
        ? Math.round(elevationM / 10) * 10
        : null,
  };
}

/** One string per cell: what a client caches a forecast under. */
export function weatherCellKey(cell: WeatherCell): string {
  return `${cell.latitude.toFixed(1)},${cell.longitude.toFixed(1)},${cell.elevationM ?? ""}`;
}

const DAILY = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "precipitation_probability_max",
  "wind_speed_10m_max",
] as const;

export function weatherRequestUrl(cell: WeatherCell): string {
  const params = new URLSearchParams({
    latitude: cell.latitude.toFixed(1),
    longitude: cell.longitude.toFixed(1),
    daily: DAILY.join(","),
    past_days: String(WEATHER_PAST_DAYS),
    forecast_days: String(WEATHER_FORECAST_DAYS),
    timezone: "auto",
  });
  // Absent, Open-Meteo uses its own DEM's height at the cell's centre, which
  // in canyon country can be hundreds of metres from the spot's.
  if (cell.elevationM != null) params.set("elevation", String(cell.elevationM));
  return `${OPEN_METEO_FORECAST_URL}?${params}`;
}

function numbers(value: unknown, length: number): (number | null)[] {
  if (!Array.isArray(value) || value.length !== length)
    throw new Error("Malformed forecast");
  return value.map((item) => (typeof item === "number" ? item : null));
}

/** Open-Meteo's answer as a forecast; throws on anything else. */
export function parseForecast(
  json: unknown,
  cell: WeatherCell,
  fetchedAt: number,
): WeatherForecast {
  const daily = (json as { daily?: Record<string, unknown> } | null)?.daily;
  const time = daily?.time;
  if (!daily || !Array.isArray(time) || time.length <= WEATHER_PAST_DAYS)
    throw new Error("Malformed forecast");
  const n = time.length;
  const [code, max, min, rain, chance, wind] = DAILY.map((key) =>
    numbers(daily[key], n),
  );
  const days: WeatherDay[] = time.map((date, i) => ({
    date: String(date),
    code: code[i] ?? 0,
    tempMaxC: max[i] ?? NaN,
    tempMinC: min[i] ?? NaN,
    rainMm: rain[i] ?? 0,
    rainChance: chance[i],
    windMaxKmh: wind[i] ?? NaN,
  }));
  return {
    cell,
    fetchedAt,
    pastRainMm: days
      .slice(0, WEATHER_PAST_DAYS)
      .reduce((sum, day) => sum + day.rainMm, 0),
    days: days.slice(WEATHER_PAST_DAYS),
  };
}

/**
 * Asks Open-Meteo for a cell's forecast. The error never carries the URL: it
 * holds the cell.
 */
export async function fetchForecast(
  cell: WeatherCell,
  options: { signal?: AbortSignal; now?: () => number } = {},
): Promise<WeatherForecast> {
  const res = await fetch(weatherRequestUrl(cell), { signal: options.signal });
  if (!res.ok) throw new Error(`Forecast request failed: ${res.status}`);
  return parseForecast(await res.json(), cell, (options.now ?? Date.now)());
}
