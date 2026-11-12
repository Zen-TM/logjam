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
/** The past days whose rain is drawn: what a canyon is still draining. */
export const WEATHER_PAST_DAYS = 7;
export const WEATHER_FORECAST_DAYS = 7;
/** The hours the hourly row shows, from the hour the forecast is read in. */
export const WEATHER_HOURS_SHOWN = 24;
/** The hours a forecast keeps, so a copy read later still has its next 24. */
export const WEATHER_HOURS_KEPT = 48;
const HOUR_MS = 3_600_000;

/**
 * The forecast models a user may ask Open-Meteo for (its `models=` ids). Each
 * is global, so covers NSW, and returns every variable requested below
 * (checked against the live API for a Blue Mountains cell, 2026-11). Left out:
 * `bom_access_global`, which has returned nothing since BoM suspended its open
 * data in June 2025. Best match is Open-Meteo's own pick and sends no `models`.
 * Guard: `weather.test.ts` ("asks for a chosen model by id").
 */
export const WEATHER_MODELS = [
  { id: "best_match", label: "Best match" },
  { id: "ecmwf_ifs", label: "ECMWF" },
  { id: "icon_seamless", label: "ICON" },
  { id: "gfs_seamless", label: "GFS" },
  { id: "ukmo_seamless", label: "UK Met Office" },
] as const;

export type WeatherModelId = (typeof WEATHER_MODELS)[number]["id"];
export const WEATHER_MODEL_DEFAULT: WeatherModelId = "best_match";

export function isWeatherModelId(value: unknown): value is WeatherModelId {
  return WEATHER_MODELS.some((model) => model.id === value);
}

export type WeatherCell = {
  latitude: number;
  longitude: number;
  /** Metres, to the nearest 10, or null where the height isn't known. */
  elevationM: number | null;
  /** Absent is best match: a copy kept before models were offered has none. */
  model?: WeatherModelId;
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

export type WeatherHour = {
  /** YYYY-MM-DDTHH:00, in the spot's own time zone. */
  time: string;
  /** Epoch ms of the start of the hour. */
  at: number;
  code: number;
  tempC: number;
  rainMm: number;
  rainChance: number | null;
  windKmh: number;
};

/** Where a day's rain figure comes from: the row says so (see `weatherRows`). */
export type WeatherRainSource = "model" | "gauge";

export type WeatherPastDay = {
  /** YYYY-MM-DD, in the spot's own time zone. */
  date: string;
  rainMm: number;
};

export type WeatherPastRain = {
  source: WeatherRainSource;
  /** The `WEATHER_PAST_DAYS` days before the fetch, oldest first. */
  days: WeatherPastDay[];
};

export type WeatherForecast = {
  cell: WeatherCell;
  /** Epoch ms. */
  fetchedAt: number;
  /** From the hour of the fetch on, up to `WEATHER_HOURS_KEPT`. */
  hours: WeatherHour[];
  past: WeatherPastRain;
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
  model: WeatherModelId = WEATHER_MODEL_DEFAULT,
): WeatherCell {
  return {
    ...(model === WEATHER_MODEL_DEFAULT ? {} : { model }),
    latitude: snap(point.latitude),
    longitude: snap(point.longitude),
    elevationM:
      elevationM != null && Number.isFinite(elevationM)
        ? Math.round(elevationM / 10) * 10
        : null,
  };
}

/**
 * One string per cell and model: what a client caches a forecast under, so one
 * model's figures are never shown for another's. Best match keeps the key it
 * had before models were offered.
 */
export function weatherCellKey(cell: WeatherCell): string {
  const model =
    cell.model && cell.model !== WEATHER_MODEL_DEFAULT ? `,${cell.model}` : "";
  return `${cell.latitude.toFixed(1)},${cell.longitude.toFixed(1)},${cell.elevationM ?? ""}${model}`;
}

const DAILY = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "precipitation_probability_max",
  "wind_speed_10m_max",
] as const;

const HOURLY = [
  "weather_code",
  "temperature_2m",
  "precipitation",
  "precipitation_probability",
  "wind_speed_10m",
] as const;

export function weatherRequestUrl(cell: WeatherCell): string {
  const params = new URLSearchParams({
    latitude: cell.latitude.toFixed(1),
    longitude: cell.longitude.toFixed(1),
    hourly: HOURLY.join(","),
    daily: DAILY.join(","),
    past_days: String(WEATHER_PAST_DAYS),
    forecast_days: String(WEATHER_FORECAST_DAYS),
    timezone: "auto",
  });
  // Absent, Open-Meteo uses its own DEM's height at the cell's centre, which
  // in canyon country can be hundreds of metres from the spot's.
  if (cell.elevationM != null) params.set("elevation", String(cell.elevationM));
  if (cell.model && cell.model !== WEATHER_MODEL_DEFAULT)
    params.set("models", cell.model);
  return `${OPEN_METEO_FORECAST_URL}?${params}`;
}

function numbers(value: unknown, length: number): (number | null)[] {
  if (!Array.isArray(value) || value.length !== length)
    throw new Error("Malformed forecast");
  return value.map((item) => (typeof item === "number" ? item : null));
}

/**
 * The instant a wall-clock time ("2026-10-04T05:00") is in a zone. The hourly
 * array spans two weeks, so one UTC offset for all of it is an hour out for
 * the hours on the other side of a daylight-saving change: the zone's own
 * rules answer for each hour. Where the runtime has no zone data (or the name
 * is not one), `fallbackOffsetMs` is all there is.
 */
export function zonedInstant(
  time: string,
  zone: string | undefined,
  fallbackOffsetMs: number,
): number {
  const [y, mo, d, h] = time.split(/[-T:]/).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h);
  const offsetAt = zoneOffset(zone);
  if (!offsetAt) return wall - fallbackOffsetMs;
  // The offset at the wall time read as UTC is within the change's hour of the
  // right one; asking again at the instant that gives settles it.
  return wall - offsetAt(wall - offsetAt(wall));
}

const zoneFormats = new Map<string, Intl.DateTimeFormat | null>();

/** The zone's UTC offset in ms at an instant, or null without zone data. */
function zoneOffset(zone: string | undefined): ((at: number) => number) | null {
  if (!zone) return null;
  if (!zoneFormats.has(zone)) {
    try {
      zoneFormats.set(
        zone,
        new Intl.DateTimeFormat("en-US", {
          timeZone: zone,
          hourCycle: "h23",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
        }),
      );
    } catch {
      zoneFormats.set(zone, null);
    }
  }
  const format = zoneFormats.get(zone);
  if (!format) return null;
  return (at) => {
    const part: Record<string, number> = {};
    for (const { type, value } of format.formatToParts(at))
      part[type] = Number(value);
    return (
      Date.UTC(
        part.year,
        part.month - 1,
        part.day,
        part.hour % 24,
        part.minute,
        part.second,
      ) -
      Math.floor(at / 1000) * 1000
    );
  };
}

function hours(
  json: {
    hourly?: Record<string, unknown>;
    utc_offset_seconds?: unknown;
    timezone?: unknown;
  },
  fetchedAt: number,
): WeatherHour[] {
  const hourly = json.hourly;
  const time = hourly?.time;
  if (!hourly || !Array.isArray(time)) throw new Error("Malformed forecast");
  const [code, temp, rain, chance, wind] = HOURLY.map((key) =>
    numbers(hourly[key], time.length),
  );
  const offsetMs =
    (typeof json.utc_offset_seconds === "number"
      ? json.utc_offset_seconds
      : 0) * 1000;
  const zone = typeof json.timezone === "string" ? json.timezone : undefined;
  const all = time.map(
    (t, i): WeatherHour => ({
      time: String(t),
      at: zonedInstant(String(t), zone, offsetMs),
      code: code[i] ?? 0,
      tempC: temp[i] ?? NaN,
      rainMm: rain[i] ?? 0,
      rainChance: chance[i],
      windKmh: wind[i] ?? NaN,
    }),
  );
  return all
    .filter((hour) => hour.at + HOUR_MS > fetchedAt)
    .slice(0, WEATHER_HOURS_KEPT);
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
    hours: hours(json as Parameters<typeof hours>[0], fetchedAt),
    past: {
      source: "model",
      days: days
        .slice(0, WEATHER_PAST_DAYS)
        .map(({ date, rainMm }) => ({ date, rainMm })),
    },
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
