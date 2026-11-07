// The Weather overlay: ECMWF IFS's forecast for NSW as a colour field, one
// quantity at a time, with a time slider over the forecast's steps, wind
// arrows, and rain totals either side of the build. `topo/build_weather.py`
// publishes it on the topo CDN after each model run; why a job and not the
// client reads Open-Meteo: ADR 0048.
//
// Every user reads the same files from our own CDN, so viewing the overlay
// sends nothing about where anyone looks to Open-Meteo or anyone else.
//
// Values are terrarium "heights" (ADR 0030), drawn with a `color-relief`
// layer as the slope archive is, so the colours are a paint expression here
// and the files hold only numbers. Past rain is the model's estimate, never a
// gauge's: each past hour from the run that began just before it.
// Guards: weatherMap.test.ts, against the fixture topo/tests/test_weather.py
// writes from the builder.
import { SHORT_WEEKDAYS } from "./dateNames.js";
import { WEATHER } from "./contracts/weather.js";

/** Bumped with the files' shape; each format has its own prefix. */
export const WEATHER_MAP_FORMAT = 1;

export const WEATHER_MAP = {
  /** A kept run is filed under this. */
  id: "weather",
  /** Under the topo CDN base URL, beside the river gauges. */
  prefix: `master/weather/v${WEATHER_MAP_FORMAT}/`,
  manifestPath: `master/weather/v${WEATHER_MAP_FORMAT}/latest.json`,
  /** The model's cells are about 9 km: the copy says so, once. */
  cellKm: 9,
} as const;

export type WeatherFieldKey = "rain" | "temperature" | "wind" | "gusts";
export type WeatherTotalKey =
  | "rainPast168"
  | "rainPast72"
  | "rainPast24"
  | "rainNext24"
  | "rainNext72";
export type WeatherLayerKey = WeatherFieldKey | WeatherTotalKey;

/** `latest.json`: the run on the CDN now. */
export type WeatherMapFile = {
  format: number;
  /** Open-Meteo's id, `ecmwf_ifs`. */
  model: string;
  /** When the model run began, ISO UTC. */
  run: string;
  /** When the job built it. */
  built: string;
  /** The hour the totals count from: the past up to it, the forecast after. */
  anchor: string;
  /** The run's folder, under `prefix`, ending in a slash. */
  path: string;
  bounds: [west: number, south: number, east: number, north: number];
  /** The one zoom the tiles hold; deeper zooms overzoom. */
  zoom: number;
  /** The slider, oldest first: a step's rain is over the `hours` to `time`. */
  steps: { time: string; hours: number }[];
  /** The totals this run has: one with an hour no run held is left out. */
  totals: WeatherTotalKey[];
  attribution: string;
};

/** `wind.json`: the arrows, a grid of `rows` × `columns` from the north-west,
 *  and per step each point's speed (km/h) and where it blows from (degrees). */
export type WeatherWindFile = {
  west: number;
  north: number;
  step: number;
  columns: number;
  rows: number;
  steps: { speed: (number | null)[]; from: (number | null)[] }[];
};

type Stop = { value: number; colour: string; label?: string };

export type WeatherLayer = {
  key: WeatherLayerKey;
  /** The picker's option, and the bar's title. */
  label: string;
  unit: string;
  /** Interpolated, low to high; a `label` stop is a legend row. */
  stops: readonly Stop[];
  /** Hours either side of the anchor, for a total; absent for a field. */
  hours?: number;
  /** Whether wind arrows go over it. */
  arrows?: boolean;
};

const CLEAR = "rgba(0,0,0,0)";

// Rain runs pale blue to violet and purple, temperature blue to red, wind
// green to red to purple: none reads as Slope's yellow-to-dark-red bands
// alone, and the overlay is drawn over them translucent, so a band still
// shows through. The alpha is in the stop: light rain stays light on the map.
const RAIN_STOPS: readonly Stop[] = [
  { value: 0.05, colour: CLEAR },
  { value: 0.2, colour: "rgba(165,216,255,0.55)", label: "0.2 mm/h" },
  { value: 1, colour: "rgba(77,171,247,0.7)", label: "1 mm/h" },
  { value: 3, colour: "rgba(28,126,214,0.8)", label: "3 mm/h" },
  { value: 8, colour: "rgba(95,61,196,0.85)", label: "8 mm/h" },
  { value: 20, colour: "rgba(59,7,100,0.9)", label: "20 mm/h" },
];
const TOTAL_STOPS: readonly Stop[] = [
  { value: 0.5, colour: CLEAR },
  { value: 2, colour: "rgba(165,216,255,0.55)", label: "2 mm" },
  { value: 10, colour: "rgba(77,171,247,0.7)", label: "10 mm" },
  { value: 25, colour: "rgba(28,126,214,0.8)", label: "25 mm" },
  { value: 50, colour: "rgba(95,61,196,0.85)", label: "50 mm" },
  { value: 100, colour: "rgba(59,7,100,0.9)", label: "100 mm" },
];
const TEMPERATURE_STOPS: readonly Stop[] = [
  // Below it is no value (−32768): clear, not the coldest colour.
  { value: -1000, colour: CLEAR },
  { value: -999, colour: "rgba(76,110,245,0.6)" },
  { value: -5, colour: "rgba(76,110,245,0.6)", label: "−5°" },
  { value: 5, colour: "rgba(116,192,252,0.6)", label: "5°" },
  { value: 15, colour: "rgba(150,242,215,0.6)", label: "15°" },
  { value: 22, colour: "rgba(255,236,153,0.6)", label: "22°" },
  { value: 30, colour: "rgba(255,146,43,0.6)", label: "30°" },
  { value: 38, colour: "rgba(201,42,42,0.65)", label: "38°" },
];
const WIND_STOPS: readonly Stop[] = [
  { value: 5, colour: CLEAR },
  { value: 15, colour: "rgba(150,242,215,0.45)", label: "15 km/h" },
  { value: 30, colour: "rgba(255,224,102,0.55)", label: "30 km/h" },
  { value: 50, colour: "rgba(255,146,43,0.65)", label: "50 km/h" },
  { value: 70, colour: "rgba(224,49,49,0.75)", label: "70 km/h" },
  { value: 100, colour: "rgba(134,46,156,0.85)", label: "100 km/h" },
];

/** The picker's options in order: the stepped fields, then the totals from
 *  the furthest past to the furthest ahead. */
export const WEATHER_LAYERS: readonly WeatherLayer[] = [
  { key: "rain", label: "Rain", unit: "mm/h", stops: RAIN_STOPS },
  {
    key: "temperature",
    label: "Temperature",
    unit: "°C",
    stops: TEMPERATURE_STOPS,
  },
  {
    key: "wind",
    label: "Wind",
    unit: "km/h",
    stops: WIND_STOPS,
    arrows: true,
  },
  {
    key: "gusts",
    label: "Gusts",
    unit: "km/h",
    stops: WIND_STOPS,
    arrows: true,
  },
  {
    key: "rainPast168",
    label: "Rain, past 7 days",
    unit: "mm",
    stops: TOTAL_STOPS,
    hours: -168,
  },
  {
    key: "rainPast72",
    label: "Rain, past 72 h",
    unit: "mm",
    stops: TOTAL_STOPS,
    hours: -72,
  },
  {
    key: "rainPast24",
    label: "Rain, past 24 h",
    unit: "mm",
    stops: TOTAL_STOPS,
    hours: -24,
  },
  {
    key: "rainNext24",
    label: "Rain, next 24 h",
    unit: "mm",
    stops: TOTAL_STOPS,
    hours: 24,
  },
  {
    key: "rainNext72",
    label: "Rain, next 72 h",
    unit: "mm",
    stops: TOTAL_STOPS,
    hours: 72,
  },
];

export const WEATHER_LAYER_DEFAULT: WeatherLayerKey = "rain";

export function weatherLayer(key: string | undefined): WeatherLayer {
  return (
    WEATHER_LAYERS.find((layer) => layer.key === key) ??
    WEATHER_LAYERS.find((layer) => layer.key === WEATHER_LAYER_DEFAULT)!
  );
}

export const isWeatherTotal = (layer: WeatherLayer): boolean =>
  layer.hours !== undefined;

/** The `color-relief-color` for a layer: its stops, interpolated. */
export function weatherReliefColor(key: WeatherLayerKey): unknown[] {
  const stops = weatherLayer(key).stops.flatMap((s) => [s.value, s.colour]);
  return ["interpolate", ["linear"], ["elevation"], ...stops];
}

/** The legend's key: each labelled stop's colour as it shows over a white
 *  map, opaque, since a legend sits on a sheet and not on the map. */
export function weatherLegendRows(
  key: WeatherLayerKey,
): { label: string; colour: string }[] {
  return weatherLayer(key).stops.flatMap((stop) =>
    stop.label ? [{ label: stop.label, colour: overWhite(stop.colour) }] : [],
  );
}

function overWhite(rgba: string): string {
  const [r, g, b, a] = rgba.match(/[\d.]+/g)!.map(Number);
  const mix = (c: number) =>
    Math.round(255 + (c - 255) * a)
      .toString(16)
      .padStart(2, "0");
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

/**
 * The manifest, or null for anything this client can't draw: another
 * format, a step or total it doesn't know, or a folder outside the prefix.
 */
export function parseWeatherMap(raw: unknown): WeatherMapFile | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Partial<WeatherMapFile>;
  const known = new Set<string>(WEATHER_LAYERS.map((l) => l.key));
  const time = (s: unknown) =>
    typeof s === "string" && Number.isFinite(Date.parse(s));
  if (
    f.format !== WEATHER_MAP_FORMAT ||
    typeof f.model !== "string" ||
    !time(f.run) ||
    !time(f.built) ||
    !time(f.anchor) ||
    typeof f.path !== "string" ||
    !/^runs\/\d{8}T\d{4}Z\/$/.test(f.path) ||
    !Array.isArray(f.bounds) ||
    f.bounds.length !== 4 ||
    !f.bounds.every(Number.isFinite) ||
    !Number.isInteger(f.zoom) ||
    !Array.isArray(f.steps) ||
    f.steps.length === 0 ||
    !f.steps.every(
      (s) => s && time(s.time) && Number.isInteger(s.hours) && s.hours > 0,
    ) ||
    !Array.isArray(f.totals) ||
    !f.totals.every((t) => known.has(t)) ||
    typeof f.attribution !== "string"
  )
    return null;
  return f as WeatherMapFile;
}

/** Where a layer's archive is for `step` (an index into `steps`; a total has
 *  one archive and ignores it), under the CDN's `base`. Null for a total the
 *  run doesn't have. */
export function weatherLayerUrl(
  base: string,
  file: WeatherMapFile,
  key: WeatherLayerKey,
  step: number,
): string | null {
  const folder = `${base.replace(/\/$/, "")}/${WEATHER_MAP.prefix}${file.path}`;
  if (isWeatherTotal(weatherLayer(key)))
    return file.totals.includes(key as WeatherTotalKey)
      ? `${folder}totals/${key}.pmtiles`
      : null;
  if (!Number.isInteger(step) || step < 0 || step >= file.steps.length)
    return null;
  return `${folder}${key}/${String(step).padStart(3, "0")}.pmtiles`;
}

export function weatherWindUrl(base: string, file: WeatherMapFile): string {
  return `${base.replace(/\/$/, "")}/${WEATHER_MAP.prefix}${file.path}wind.json`;
}

/** The step `now` falls in: the first that ends at or after it. Null when
 *  every step is past: a run that old is never drawn as today's. */
export function weatherStepAt(
  file: WeatherMapFile,
  now: number,
): number | null {
  const i = file.steps.findIndex((s) => Date.parse(s.time) >= now);
  return i < 0 ? null : i;
}

/** "Today, 5 pm" or "Sat 8, 2 pm", on this device's clock. */
export function weatherTimeLabel(time: string, now: number): string {
  const d = new Date(time);
  const today = new Date(now);
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const h = d.getHours();
  const hour = `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
  const day = sameDay
    ? WEATHER.copy.today
    : `${SHORT_WEEKDAYS[d.getDay()]} ${d.getDate()}`;
  return `${day}, ${hour}`;
}

/** What the bar says the map shows: a step's time, or a total's window. */
export function weatherShownLabel(
  file: WeatherMapFile,
  key: WeatherLayerKey,
  step: number,
  now: number,
): string {
  const layer = weatherLayer(key);
  if (layer.hours === undefined) {
    const s = file.steps[step];
    return s ? weatherTimeLabel(s.time, now) : "";
  }
  const anchor = Date.parse(file.anchor);
  const edge = anchor + layer.hours * 3_600_000;
  return layer.hours < 0
    ? `To ${weatherTimeLabel(file.anchor, now)}`
    : `To ${weatherTimeLabel(new Date(edge).toISOString(), now)}`;
}

/** The wind arrows of one step, as points a symbol layer rotates: `rotate`
 *  turns the route arrowhead (which points east) to where the wind blows. */
export function windArrows(
  wind: WeatherWindFile,
  step: number,
): {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { speed: number; rotate: number };
  }[];
} {
  const at = wind.steps[step];
  const features = [];
  if (at)
    for (let i = 0; i < wind.rows * wind.columns; i++) {
      const speed = at.speed[i];
      const from = at.from[i];
      if (speed == null || from == null) continue;
      const row = Math.floor(i / wind.columns);
      const column = i % wind.columns;
      features.push({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [
            wind.west + column * wind.step,
            wind.north - row * wind.step,
          ] as [number, number],
        },
        // Towards is `from` + 180°; the arrowhead at 0° points east (90°).
        properties: { speed, rotate: (from + 90) % 360 },
      });
    }
  return { type: "FeatureCollection", features };
}
