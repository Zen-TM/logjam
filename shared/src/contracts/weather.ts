// THE WEATHER AT A SPOT: the forecast both clients show for a place on its
// page and for a point pressed on the map, behind "Show the weather here". It
// answers what a canyoner checks before going: what each of the next hours and
// days brings, and what has fallen already (a canyon drains for days). Each is
// a row of cards that scrolls sideways (`weatherRows`).
//
// Online only to fetch. Logjam GPS keeps the last forecast for each spot and
// shows it offline with its age; refreshing then says "Needs a connection"
// (shared/DESIGN.md §5). Logjam Web, at a desk, keeps none.
//
// The rows are one function both clients draw (`weatherRows`). The
// credit is CC BY 4.0's condition for Open-Meteo's data: it is always drawn.
//
// The rain that has fallen is measured where a rain gauge is near enough
// (rainGauges.ts, ADR 0047): a row per gauge, named, with Open-Meteo's
// figure only on the days the gauge has not sent yet, each marked.
import type { IconIdea } from "../icons.js";
import { RAIN_GAUGE_MAX_M, type PastRain } from "../rainGauges.js";
import { formatDistanceM } from "../trackStats.js";
import { gaugeDisplayName } from "./gauges.js";
import {
  OPEN_METEO_CREDIT_URL,
  WEATHER_HOURS_SHOWN,
  WEATHER_PAST_DAYS,
  type WeatherDay,
  type WeatherForecast,
  type WeatherHour,
} from "../weather.js";
import type { ScreenContract } from "./types.js";

export const WEATHER = {
  id: "weather",
  question: "What will the weather be here?",
  title: "Weather",
  sections: [
    { key: "hours" },
    { key: "days" },
    { key: "past" },
    { key: "credit" },
  ],
  copy: {
    show: "Show the weather here",
    hours: `Next ${WEATHER_HOURS_SHOWN} hours`,
    days: "Next 7 days",
    // Named for where its figures come from, so a measured week (a gauge's)
    // never reads as the model's guess, and the other way round.
    pastModel: `Modelled rain, past ${WEATHER_PAST_DAYS} days`,
    pastGauge: "Rain gauge at",
    // Under a gauge's day that Open-Meteo filled in.
    modelledDay: "Model",
    gaugeNote:
      "Gauges count rain from 9 am to 9 am and report a day or two late; a day marked Model is Open-Meteo's.",
    noGaugeNear: `No rain gauge within ${RAIN_GAUGE_MAX_M / 1000} km, so these are Open-Meteo's.`,
    model: "Forecast model",
    // Says what the choice means; the models' names are `WEATHER_MODELS`.
    // Logjam GPS shows it above the chips. Logjam Web's menu heads the list
    // with `model` instead: a menu heading holds two lines, and this is more.
    modelHint:
      "Best match lets Open-Meteo choose; pick a model to see its own forecast.",
    now: "Now",
    earlier: "Scroll back",
    later: "Scroll on",
    loading: "Getting the forecast…",
    failed: "Couldn't get the forecast.",
    needsConnection: "Needs a connection",
    refresh: "Refresh",
    hide: "Hide",
    tryAgain: "Try again",
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

/** Drawn where a figure is none (0 mm, 0%, no wind): the wet ones stand out. */
export const WEATHER_NONE = "–";

/** The least rain a figure is drawn for: below it "0.0 mm" would be noise. */
const RAIN_SHOWN_MM = 0.05;

const rainText = (mm: number): string =>
  mm >= RAIN_SHOWN_MM ? formatRainMm(mm) : WEATHER_NONE;
const chanceText = (percent: number): string =>
  percent > 0 ? `${percent}%` : WEATHER_NONE;
// A figure and its unit are joined by a no-break space, so a narrow card or
// a large font never strands the unit on a line of its own.
const UNIT = "\u00a0";
const windText = (kmh: number): string =>
  Math.round(kmh) > 0 ? `${Math.round(kmh)}${UNIT}km/h` : WEATHER_NONE;

export function formatRainMm(mm: number): string {
  return `${mm > 0 && mm < 1 ? mm.toFixed(1) : Math.round(mm)}${UNIT}mm`;
}

export type WeatherDayFacts = {
  date: string;
  /** "Today", or "Mon 20". */
  day: string;
  condition: WeatherCondition;
  /** "4–17°" */
  temperature: string;
  /** "6 mm", or `WEATHER_NONE` for a dry day. */
  rain: string;
  /** "70%"; null for a day already past, which has no chance. */
  chance: string | null;
  /** "25 km/h" */
  wind: string;
};

/** "Mon 20". */
function weekdayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}`;
}

/** "Today", or "Mon 20". */
function dayLabel(date: string, now: number): string {
  return date === localDate(now) ? WEATHER.copy.today : weekdayLabel(date);
}

export function weatherDayFacts(day: WeatherDay, now: number): WeatherDayFacts {
  return {
    date: day.date,
    day: dayLabel(day.date, now),
    condition: weatherCondition(day.code),
    // Degrees alone, as an hour's card says them: a "C" wrapped onto its own
    // line in a day card with a two-digit low (weather.test.ts pins it).
    temperature: `${Math.round(day.tempMinC)}–${Math.round(day.tempMaxC)}°`,
    rain: rainText(day.rainMm),
    chance: day.rainChance != null ? chanceText(day.rainChance) : null,
    wind: windText(day.windMaxKmh),
  };
}

/** The next `WEATHER_HOURS_SHOWN` hours, from the one `now` falls in. */
export function weatherHoursFrom(
  forecast: WeatherForecast,
  now: number,
): WeatherHour[] {
  return forecast.hours
    .filter((hour) => hour.at + 3_600_000 > now)
    .slice(0, WEATHER_HOURS_SHOWN);
}

/** One cell of a row: the same anatomy for an hour, a day and a past day. */
export type WeatherCard = {
  key: string;
  /** "Now", "3 pm", "Today", "Mon 20". */
  label: string;
  /** The first card of the hourly and daily rows: the one the eye starts on. */
  current: boolean;
  /** Null where a figure is a rain total, which no single condition names. */
  glyph: IconIdea | null;
  glyphLabel: string;
  /** "14°" for an hour, "4–17°" for a day; null for a past day. */
  temperature: string | null;
  /** "0.4 mm"; `WEATHER_NONE` where none fell, so the wet cards stand out. */
  rain: string;
  /** 0 to 1: how much of its row's wettest card this one is. Zero is empty. */
  rainLevel: number;
  /** "70%", where the model gave one; `WEATHER_NONE` for 0. */
  chance: string | null;
  /** "25 km/h" or `WEATHER_NONE`; null for a past day. */
  wind: string | null;
  /** `WEATHER.copy.modelledDay` on a gauge's day that the model filled in:
   *  said under the figure, and its bar drawn muted. Null otherwise. */
  note: string | null;
  /** Every figure on the card, in words, for a screen reader. */
  spoken: string;
};

export type WeatherRowKey = Exclude<
  (typeof WEATHER.sections)[number]["key"],
  "credit"
>;

export type WeatherRow = {
  key: WeatherRowKey;
  title: string;
  /** "34 mm" over the row's days, for the rain row; null otherwise. */
  summary: string | null;
  cards: WeatherCard[];
  /** A line under the row, saying where its figures come from. */
  note: string | null;
};

// A row's bars are against its wettest card, but never against less than this:
// a drizzle must not fill the bar a downpour would.
const RAIN_FULL_MM: Record<WeatherRowKey, number> = {
  hours: 4,
  days: 20,
  past: 20,
};

function rainLevels(key: WeatherRowKey, mm: number[]): number[] {
  const full = Math.max(RAIN_FULL_MM[key], ...mm);
  return mm.map((value) => (value >= RAIN_SHOWN_MM ? value / full : 0));
}

function hourLabel(hour: WeatherHour): string {
  const h = Number(hour.time.slice(11, 13));
  return `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
}

/**
 * The rows both clients draw, in the order of `WEATHER.sections`: the next
 * hours, the next days, the rain that has fallen. A row with nothing left in it
 * (a kept forecast that has outlived its hours) is absent.
 *
 * The rain that has fallen is a row for each gauge in `rain` or, with none,
 * the model's row; `rain` is null where the gauge file could not be had, and
 * the model's row then says nothing of gauges.
 */
export function weatherRows(
  forecast: WeatherForecast,
  now: number,
  rain: PastRain | null = null,
): WeatherRow[] {
  const hours = weatherHoursFrom(forecast, now);
  const days = weatherDaysFrom(forecast, now);
  const hourLevels = rainLevels(
    "hours",
    hours.map((h) => h.rainMm),
  );
  const dayLevels = rainLevels(
    "days",
    days.map((d) => d.rainMm),
  );
  const rows: WeatherRow[] = [
    {
      key: "hours",
      // A kept copy read late has fewer than a day's hours left: the title says
      // how many rather than promising 24.
      title:
        hours.length < WEATHER_HOURS_SHOWN
          ? `Next ${hours.length} ${hours.length === 1 ? "hour" : "hours"}`
          : WEATHER.copy.hours,
      summary: null,
      note: null,
      cards: withSpoken(
        hours.map((hour, i) => {
          const condition = weatherCondition(hour.code);
          const current = i === 0 && hour.at <= now;
          // The first card of a new date says which day it is, in place of its
          // hour (spoken, it gives both).
          const date = hour.time.slice(0, 10);
          const newDay = i > 0 && date !== hours[i - 1].time.slice(0, 10);
          return {
            key: hour.time,
            label: current
              ? WEATHER.copy.now
              : newDay
                ? weekdayLabel(date)
                : hourLabel(hour),
            spokenLabel: newDay
              ? `${weekdayLabel(date)}, ${hourLabel(hour)}`
              : undefined,
            current,
            glyph: condition.icon,
            glyphLabel: condition.label,
            temperature: `${Math.round(hour.tempC)}°`,
            rain: rainText(hour.rainMm),
            rainLevel: hourLevels[i],
            chance:
              hour.rainChance != null ? chanceText(hour.rainChance) : null,
            wind: windText(hour.windKmh),
            note: null,
          };
        }),
      ),
    },
    {
      key: "days",
      title: WEATHER.copy.days,
      summary: null,
      note: null,
      cards: withSpoken(
        days.map((day, i) => {
          const facts = weatherDayFacts(day, now);
          return {
            key: facts.date,
            label: facts.day,
            current: facts.date === localDate(now),
            glyph: facts.condition.icon,
            glyphLabel: facts.condition.label,
            temperature: facts.temperature,
            rain: facts.rain,
            rainLevel: dayLevels[i],
            chance: facts.chance,
            wind: facts.wind,
            note: null,
          };
        }),
      ),
    },
    ...pastRows(forecast, now, rain),
  ];
  return rows.filter((row) => row.cards.length > 0);
}

/** One row of a past day's rain: the model's, or a gauge's with the model's
 *  figure where the gauge has none (`measured` null). */
function pastRow(
  forecast: WeatherForecast,
  now: number,
  title: string,
  measured: (number | null)[] | null,
  note: string | null,
): WeatherRow {
  const days = forecast.past.days.map((day, i) => {
    const mm = measured?.[i] ?? null;
    return { day, mm: mm ?? day.rainMm, modelled: !!measured && mm === null };
  });
  const levels = rainLevels(
    "past",
    days.map((d) => d.mm),
  );
  return {
    key: "past",
    title,
    summary: formatRainMm(days.reduce((sum, d) => sum + d.mm, 0)),
    note,
    cards: withSpoken(
      days.map(({ day, mm, modelled }, i) => ({
        key: day.date,
        label: dayLabel(day.date, now),
        current: false,
        glyph: null,
        glyphLabel: "",
        temperature: null,
        rain: rainText(mm),
        rainLevel: levels[i],
        chance: null,
        wind: null,
        note: modelled ? WEATHER.copy.modelledDay : null,
      })),
    ),
  };
}

function pastRows(
  forecast: WeatherForecast,
  now: number,
  rain: PastRain | null,
): WeatherRow[] {
  if (!rain?.gauges.length)
    return [
      pastRow(
        forecast,
        now,
        WEATHER.copy.pastModel,
        null,
        rain ? WEATHER.copy.noGaugeNear : null,
      ),
    ];
  return rain.gauges.map((g, i) =>
    pastRow(
      forecast,
      now,
      `${WEATHER.copy.pastGauge} ${gaugeDisplayName(g.gauge.name)}, ${formatDistanceM(g.distanceM)}`,
      g.mm,
      i === rain.gauges.length - 1 ? WEATHER.copy.gaugeNote : null,
    ),
  );
}

type BareCard = Omit<WeatherCard, "spoken"> & { spokenLabel?: string };

function withSpoken(cards: BareCard[]): WeatherCard[] {
  return cards.map(({ spokenLabel, ...card }) => ({
    ...card,
    spoken: [
      spokenLabel ?? card.label,
      card.glyphLabel,
      card.temperature,
      card.rain === WEATHER_NONE ? "no rain" : `rain ${card.rain}`,
      card.chance &&
        `${card.chance === WEATHER_NONE ? "0%" : card.chance} chance`,
      card.wind &&
        (card.wind === WEATHER_NONE ? "no wind" : `wind ${card.wind}`),
      card.note === WEATHER.copy.modelledDay && "modelled",
    ]
      .filter(Boolean)
      .join(", "),
  }));
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
