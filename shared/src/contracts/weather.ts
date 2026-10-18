// THE WEATHER AT A SPOT: the forecast both clients show for a place on its
// page and for a point pressed on the map, behind "Show the weather here". It
// answers what a canyoner checks before going: what has fallen already (a
// canyon drains for days), and what each of the next days brings.
//
// Online only to fetch. Logjam GPS keeps the last forecast for each spot and
// shows it offline with its age; refreshing then says "Needs a connection"
// (shared/DESIGN.md §5). Logjam Web, at a desk, keeps none.
//
// The figures are one function both clients draw (`weatherDayFacts`). The
// credit is CC BY 4.0's condition for Open-Meteo's data: it is always drawn.
import type { IconIdea } from "../icons.js";
import {
  OPEN_METEO_CREDIT_URL,
  WEATHER_PAST_DAYS,
  type WeatherDay,
  type WeatherForecast,
} from "../weather.js";
import type { ScreenContract } from "./types.js";

export const WEATHER = {
  id: "weather",
  question: "What will the weather be here?",
  title: "Weather",
  sections: [{ key: "pastRain" }, { key: "days" }, { key: "credit" }],
  copy: {
    show: "Show the weather here",
    pastRain: `Rain, past ${WEATHER_PAST_DAYS} days`,
    loading: "Getting the forecast…",
    failed: "Couldn’t get the forecast.",
    needsConnection: "Needs a connection",
    refresh: "Refresh",
    // Every day the forecast held is past: a stale forecast is never shown.
    outOfDate: "This forecast has run out.",
    today: "Today",
    credit: "Weather data by Open-Meteo.com",
  },
} as const satisfies ScreenContract;

export const WEATHER_CREDIT_URL = OPEN_METEO_CREDIT_URL;

export type WeatherCondition = { label: string; icon: IconIdea };

/** WMO code ranges, first match wins. */
const WEATHER_CONDITIONS: readonly [
  (code: number) => boolean,
  WeatherCondition,
][] = [
  [(c) => c === 0, { label: "Clear", icon: "weatherClear" }],
  [(c) => c <= 2, { label: "Partly cloudy", icon: "weatherPartCloud" }],
  [(c) => c === 3, { label: "Cloudy", icon: "weatherCloud" }],
  [(c) => c === 45 || c === 48, { label: "Fog", icon: "weatherFog" }],
  [(c) => c >= 51 && c <= 57, { label: "Drizzle", icon: "weatherDrizzle" }],
  [(c) => c >= 61 && c <= 67, { label: "Rain", icon: "weatherRain" }],
  [(c) => c >= 71 && c <= 77, { label: "Snow", icon: "weatherSnow" }],
  [(c) => c >= 80 && c <= 82, { label: "Showers", icon: "weatherRain" }],
  [(c) => c === 85 || c === 86, { label: "Snow", icon: "weatherSnow" }],
  [(c) => c >= 95, { label: "Thunderstorms", icon: "weatherStorm" }],
];

export function weatherCondition(code: number): WeatherCondition {
  return (
    WEATHER_CONDITIONS.find(([test]) => test(code))?.[1] ?? {
      label: "Cloudy",
      icon: "weatherCloud",
    }
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** YYYY-MM-DD on this device's calendar. */
export function localDate(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The days still to come, from today: a kept forecast loses its past ones. */
export function weatherDaysFrom(
  forecast: WeatherForecast,
  now: number,
): WeatherDay[] {
  const today = localDate(now);
  return forecast.days.filter((day) => day.date >= today);
}

export function formatRainMm(mm: number): string {
  return `${mm > 0 && mm < 1 ? mm.toFixed(1) : Math.round(mm)} mm`;
}

export type WeatherDayFacts = {
  date: string;
  /** "Today", or "Mon 20". */
  day: string;
  condition: WeatherCondition;
  /** "4–17°" */
  temperature: string;
  /** "6 mm · 70%"; the chance is left out where there is none. */
  rain: string;
  /** "25 km/h" */
  wind: string;
};

export function weatherDayFacts(day: WeatherDay, now: number): WeatherDayFacts {
  const [y, m, d] = day.date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return {
    date: day.date,
    day: day.date === localDate(now) ? WEATHER.copy.today : `${weekday} ${d}`,
    condition: weatherCondition(day.code),
    temperature: `${Math.round(day.tempMinC)}–${Math.round(day.tempMaxC)}°`,
    rain:
      day.rainChance != null
        ? `${formatRainMm(day.rainMm)} · ${day.rainChance}%`
        : formatRainMm(day.rainMm),
    wind: `${Math.round(day.windMaxKmh)} km/h`,
  };
}

/** "Updated 3 h ago": how old the figures on screen are. */
export function weatherAge(fetchedAt: number, now: number): string {
  const minutes = Math.floor((now - fetchedAt) / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days} ${days === 1 ? "day" : "days"} ago`;
}
