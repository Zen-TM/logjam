// The Weather overlay: ECMWF IFS's forecast for NSW as a colour field, one
// quantity at a time, with a time slider over the forecast's steps, wind
// arrows, and rain totals either side of the build. `topo/build_weather.py`
// publishes it on the topo CDN after each model run; why a job and not the
// client reads Open-Meteo: ADR 0049.
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
import { MAP_TERRAIN } from "./contracts/mapTerrain.js";
import { WEATHER, weatherAge } from "./contracts/weather.js";
import {
  mixHex,
  parseRgbaHex,
  type RgbaHex,
  rgbaCssFromHex,
} from "./topoSettings.js";

export { WIND_ARROW_SDF_URI } from "./windArrowSdf.js";

/** Style-image name for the wind arrow, registered by each client's map. It
 *  points east, as the route arrowhead does, so `windArrowsIn`' `rotate` turns
 *  it downwind. */
export const WIND_ARROW_IMAGE = "wind-arrow";

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
  /** The job's ATTRIBUTION, which every manifest carries: CC BY 4.0's
   *  condition. Guard: topo/tests/test_weather.py. */
  credit: "Weather data by Open-Meteo.com (CC BY 4.0), ECMWF IFS",
  /** A manifest this old is asked for again on the next turn-on or return
   *  to the map; nothing polls. Guards: frontend useWeatherMap.test.tsx,
   *  mobile weatherMapRefetch.test.ts. */
  refreshAfterMs: 3_600_000,
  /** How often an open map re-reads the clock, for the step now falls in. */
  clockMs: 300_000,
  /** How long the scrubber rests before the map asks for that step. */
  settleMs: 150,
  /** How long Play rests on a step before it moves to the next. */
  playMs: 1000,
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

/** `colour` is `#rrggbbaa`: the alpha is how much of the map shows through. */
type Stop = { value: number; colour: RgbaHex; label?: string };

export type WeatherLayer = {
  key: WeatherLayerKey;
  /** The bar's title, and the picker's option for a stepped layer. */
  label: string;
  unit: string;
  /** Interpolated, low to high; a `label` stop is a legend row. */
  stops: readonly Stop[];
  /** Hours either side of the anchor, for a total; absent for a field. */
  hours?: number;
  /** A total's short name on the card's rail ("Past 24 h"); absent for a
   *  field. Guard: weatherMap.test.ts holds `period` and `hours` together. */
  period?: string;
  /** Whether wind arrows go over it. */
  arrows?: boolean;
};

// The first stop of each ramp is its first colour with no alpha, not clear
// black: MapLibre mixes the channels as they are, so a fade from black draws a
// grey fringe round every shower. Guard: weatherMap.test.ts.
const clearOf = (colour: RgbaHex): RgbaHex => `${colour.slice(0, 7)}00`;

// Rain and its totals take the BoM radar's hues (lavender, blue, teal, then
// yellow, orange and red for heavy falls), the ones an Australian already
// reads a rain map in. Temperature runs purple to red through green and
// wind green to red to purple, each with enough hues to read a value by eye.
// The alpha is in the stop: light rain stays light, and the overlay is drawn
// under the contours and labels, so the map stays legible over a heavy band.
const RADAR = {
  lavender: "#a9a9ff",
  blue: "#4b5bff",
  teal: "#00bfae",
  yellow: "#ffd500",
  orange: "#ff8a00",
  red: "#e60000",
  maroon: "#7a0010",
} as const;

function radarRamp(values: readonly number[], alpha: readonly string[]) {
  const hues = Object.values(RADAR);
  return values.map(
    (value, i): Stop => ({
      value,
      colour: `${hues[i]}${alpha[i]}`,
      label: String(value),
    }),
  );
}

function withClear(below: number, stops: readonly Stop[]): readonly Stop[] {
  return [{ value: below, colour: clearOf(stops[0]!.colour) }, ...stops];
}

const RAIN_STOPS = withClear(
  0.1,
  radarRamp(
    [0.2, 1, 2.5, 5, 10, 20, 40],
    ["99", "b3", "bf", "c7", "cc", "d1", "d9"],
  ),
);
const TOTAL_STOPS = withClear(
  1,
  radarRamp(
    [2, 10, 25, 50, 100, 200, 400],
    ["73", "8c", "99", "a6", "b3", "bf", "c7"],
  ),
);
const TEMPERATURE_COLOURS: readonly [number, string][] = [
  [-5, "#7048e8"],
  [0, "#3b5bdb"],
  [8, "#1098ad"],
  [15, "#40c057"],
  [22, "#fab005"],
  [30, "#f76707"],
  [38, "#e03131"],
  [45, "#862e9c"],
];
const TEMPERATURE_STOPS: readonly Stop[] = [
  // Below it is no value (−32768): clear, not the coldest colour.
  { value: -1000, colour: "#7048e800" },
  { value: -999, colour: "#7048e88c" },
  ...TEMPERATURE_COLOURS.map(([value, hex]) => ({
    value,
    colour: `${hex}8c`,
    label: String(value).replace("-", "−"),
  })),
];
const WIND_STOPS = withClear(5, [
  { value: 10, colour: "#74c0fc4d", label: "10" },
  { value: 20, colour: "#69db7c80", label: "20" },
  { value: 35, colour: "#ffd43b99", label: "35" },
  { value: 50, colour: "#ff922ba6", label: "50" },
  { value: 70, colour: "#f03e3eb3", label: "70" },
  { value: 100, colour: "#ae3ec9bf", label: "100" },
]);

/** Every layer the overlay can draw, in order: the stepped fields, then the
 *  totals from the furthest past to the furthest ahead. The picker offers the
 *  fields and one chip for the totals (`WEATHER_TOTALS_CHIP`); the card's
 *  rail offers the totals by their `period`. */
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
    period: MAP_TERRAIN.copy.weatherPast168,
  },
  {
    key: "rainPast72",
    label: "Rain, past 72 h",
    unit: "mm",
    stops: TOTAL_STOPS,
    hours: -72,
    period: MAP_TERRAIN.copy.weatherPast72,
  },
  {
    key: "rainPast24",
    label: "Rain, past 24 h",
    unit: "mm",
    stops: TOTAL_STOPS,
    hours: -24,
    period: MAP_TERRAIN.copy.weatherPast24,
  },
  {
    key: "rainNext24",
    label: "Rain, next 24 h",
    unit: "mm",
    stops: TOTAL_STOPS,
    hours: 24,
    period: MAP_TERRAIN.copy.weatherNext24,
  },
  {
    key: "rainNext72",
    label: "Rain, next 72 h",
    unit: "mm",
    stops: TOTAL_STOPS,
    hours: 72,
    period: MAP_TERRAIN.copy.weatherNext72,
  },
];

export const WEATHER_LAYER_DEFAULT: WeatherLayerKey = "rain";

export function weatherLayer(key: string | undefined): WeatherLayer {
  return (
    WEATHER_LAYERS.find((layer) => layer.key === key) ??
    WEATHER_LAYERS.find((layer) => layer.key === WEATHER_LAYER_DEFAULT)!
  );
}

/**
 * The totals as the card's periods, past to future, read off `WEATHER_LAYERS`.
 * The layer picker shows them as one chip (`WEATHER_TOTALS_CHIP`) and the card
 * holds the choice among them. Guard: weatherMap.test.ts.
 */
export const WEATHER_PERIODS: readonly {
  value: WeatherTotalKey;
  label: string;
}[] = WEATHER_LAYERS.flatMap((l) =>
  l.period === undefined
    ? []
    : [{ value: l.key as WeatherTotalKey, label: l.period }],
);

/** The picker's chip for every total; not a layer key. */
export const WEATHER_TOTALS_CHIP = "rainTotals";

/** The total the chip picks from a stepped layer, when the run has it. */
export const WEATHER_PERIOD_DEFAULT: WeatherTotalKey = "rainPast24";

const isPeriod = (key: string | null | undefined) =>
  WEATHER_PERIODS.some((p) => p.value === key);

/**
 * The card's rail: every period, those the run's manifest lacks disabled (a
 * run drops a total when an hour it needs is missing). Every period is on
 * until a manifest is known.
 */
export const weatherPeriodOptions = (
  totals?: readonly string[] | null,
): { value: WeatherTotalKey; label: string; disabled: boolean }[] =>
  WEATHER_PERIODS.map((p) => ({
    ...p,
    disabled: totals != null && !totals.includes(p.value),
  }));

/** The total the totals chip picks: 24 h past, else the first the run has. */
export const weatherPeriodDefault = (
  totals?: readonly string[] | null,
): WeatherTotalKey =>
  totals == null || totals.includes(WEATHER_PERIOD_DEFAULT)
    ? WEATHER_PERIOD_DEFAULT
    : (WEATHER_PERIODS.find((p) => totals.includes(p.value))?.value ??
      WEATHER_PERIOD_DEFAULT);

/** The picker's chip that stands for the stored layer `key`. */
export const weatherChip = (key: string | null | undefined): string =>
  isPeriod(key) ? WEATHER_TOTALS_CHIP : (key ?? WEATHER_LAYER_DEFAULT);

/** The layer to store when `chip` is pressed with `key` stored: the totals
 *  chip keeps the period already picked, else takes the run's default. */
export const weatherChipLayer = (
  chip: string,
  key: string | null | undefined,
  totals?: readonly string[] | null,
) =>
  chip !== WEATHER_TOTALS_CHIP
    ? chip
    : isPeriod(key)
      ? key!
      : weatherPeriodDefault(totals);

export const isWeatherTotal = (layer: WeatherLayer): boolean =>
  layer.hours !== undefined;

/** The `color-relief-color` for a layer: its stops, interpolated. */
export function weatherReliefColor(key: WeatherLayerKey): unknown[] {
  const stops = weatherLayer(key).stops.flatMap((s) => [
    s.value,
    rgbaCssFromHex(s.colour),
  ]);
  return ["interpolate", ["linear"], ["elevation"], ...stops];
}

/** The bar's colour scale: each labelled stop's colour as it shows over a
 *  white map, opaque, with its bare number; the bar names the unit once. A
 *  strip spaces them evenly, so the gradient between two labels is the map's
 *  own linear mix. Guard: weatherMap.test.ts. */
export function weatherScale(
  key: WeatherLayerKey,
): { label: string; colour: string }[] {
  return weatherLayer(key).stops.flatMap((stop) =>
    stop.label
      ? [
          {
            label: stop.label,
            colour: mixHex(
              "#ffffff",
              stop.colour.slice(0, 7),
              parseRgbaHex(stop.colour)[3] / 255,
            ),
          },
        ]
      : [],
  );
}

/** The legend's key: the scale's stops, each with the unit, since a legend
 *  row stands alone on a sheet. */
export function weatherLegendRows(
  key: WeatherLayerKey,
): { label: string; colour: string }[] {
  const { unit } = weatherLayer(key);
  return weatherScale(key).map(({ label, colour }) => ({
    label: `${label} ${unit}`,
    colour,
  }));
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
    !/^runs\/\d{8}T\d{4}Z-\d{8}T\d{4}Z\/$/.test(f.path) ||
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

/** The step Play moves to: the next, and from the last back to the first the
 *  scrubber allows, so it loops. Guard: weatherMap.test.ts. */
export function weatherNextStep(
  step: number,
  first: number,
  last: number,
): number {
  return step >= last || step < first ? first : step + 1;
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

/**
 * What the overlay shows for a manifest, the layer picked and the step the
 * user picked (null until they do), on both clients: the step clamped to
 * those still to come, starting at the one now falls in. A stepped layer
 * whose every step is past is out of date, never drawn as today's; a total
 * the run left out (an hour no run held) is missing. Each client maps this to
 * its own bar and archive. Guard: weatherMap.test.ts.
 */
export type WeatherShown =
  | { kind: "outOfDate" | "missing" }
  | {
      kind: "ready";
      layer: WeatherLayer;
      /** Index into the manifest's steps; null for a total. */
      step: number | null;
      /** The scrubber's reach; both 0 for a total. */
      first: number;
      last: number;
      /** The step's time, or the total's window. */
      shown: string;
      /** The run's age. */
      age: string;
    };

/** The step the user picked, for the run it was picked in. */
export type WeatherPick = { path: string; step: number };

export function weatherShown(input: {
  file: WeatherMapFile;
  layer: WeatherLayerKey;
  /** Counts only in the run it was made in: a new run opens where now is. */
  picked: WeatherPick | null;
  now: number;
}): WeatherShown {
  const { file, now } = input;
  const layer = weatherLayer(input.layer);
  const age = weatherAge(Date.parse(file.built), now);
  if (isWeatherTotal(layer)) {
    if (!file.totals.includes(layer.key as WeatherTotalKey))
      return { kind: "missing" };
    const shown = weatherShownLabel(file, layer.key, 0, now);
    return { kind: "ready", layer, step: null, first: 0, last: 0, shown, age };
  }
  const first = weatherStepAt(file, now);
  if (first === null) return { kind: "outOfDate" };
  const last = file.steps.length - 1;
  const step = Math.min(
    last,
    Math.max(
      first,
      Math.round(input.picked?.path === file.path ? input.picked.step : first),
    ),
  );
  const shown = weatherShownLabel(file, layer.key, step, now);
  return { kind: "ready", layer, step, first, last, shown, age };
}

/** `wind.json` if it has the shape `windArrowsIn` reads, else null: a bad file
 *  draws no arrows rather than throwing. */
export function parseWeatherWind(raw: unknown): WeatherWindFile | null {
  const w = raw as Partial<WeatherWindFile> | null;
  return w &&
    typeof w === "object" &&
    [w.west, w.north, w.step, w.columns, w.rows].every(Number.isFinite) &&
    Array.isArray(w.steps) &&
    w.steps.every((s) => Array.isArray(s?.speed) && Array.isArray(s?.from))
    ? (w as WeatherWindFile)
    : null;
}

/** Where the arrows go: the map's visible box, in degrees. */
export type WindBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** Screen pixels between arrows, and the most arrows a viewport gets. A fixed
 *  lattice and not collision: collision let the basemap's town names knock out
 *  arrows over land, where they matter, and left the sea full. */
const ARROW_GAP_PX = 90;
const MAX_ARROWS = 600;
/** Pixels in a degree of longitude at zoom 0: the 512 px tiles MapLibre draws. */
const WORLD_PX = 512;

const rad = Math.PI / 180;

/**
 * The wind arrows of one step for the map as it is, as points a symbol layer
 * rotates: `rotate` turns the route arrowhead (which points east) to where the
 * wind blows.
 *
 * The points sit on a lattice that is the file's grid times a power of two
 * (every fourth point at a state-wide zoom, every cell close in, a fraction of
 * one closer), from the grid's north-west corner, so they stay about
 * `ARROW_GAP_PX` apart at any zoom and do not swim as the map pans. Between
 * grid points the wind is interpolated bilinearly as u/v, never as speed and
 * direction, which wrap. A lattice with more than `MAX_ARROWS` points in the
 * box doubles its spacing. None outside the grid. Guard: weatherMap.test.ts.
 */
export function windArrowsIn(
  wind: WeatherWindFile,
  step: number,
  bounds: WindBounds,
  zoom: number,
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
  const { west, north, columns, rows } = wind;
  if (!at || columns < 1 || rows < 1 || !(wind.step > 0))
    return { type: "FeatureCollection", features: [] };
  const lonSpan = (columns - 1) * wind.step;
  const latSpan = (rows - 1) * wind.step;
  const ideal = (ARROW_GAP_PX * 360) / (WORLD_PX * 2 ** zoom);
  let spacing = wind.step * 2 ** Math.round(Math.log2(ideal / wind.step));
  // One spacing of margin, so a pan does not show an empty edge before it ends.
  const range = (from: number, to: number, span: number, origin: number) => {
    const lo = Math.max(0, Math.ceil((from - origin) / spacing - 1e-9));
    const hi = Math.min(
      Math.floor(span / spacing + 1e-9),
      Math.floor((to - origin) / spacing + 1),
    );
    return [lo, hi] as const;
  };
  let across: readonly [number, number];
  let down: readonly [number, number];
  for (;;) {
    across = range(bounds.west - spacing, bounds.east, lonSpan, west);
    // Rows count down from the north edge.
    down = range(-bounds.north - spacing, -bounds.south, latSpan, -north);
    if (
      (across[1] - across[0] + 1) * (down[1] - down[0] + 1) <= MAX_ARROWS ||
      spacing > Math.max(lonSpan, latSpan)
    )
      break;
    spacing *= 2;
  }
  const speedAt = (r: number, c: number) => at.speed[r * columns + c];
  const fromAt = (r: number, c: number) => at.from[r * columns + c];
  for (let j = down[0]; j <= down[1]; j++) {
    for (let i = across[0]; i <= across[1]; i++) {
      const fx = (i * spacing) / wind.step;
      const fy = (j * spacing) / wind.step;
      const c0 = Math.min(Math.floor(fx + 1e-9), Math.max(columns - 2, 0));
      const r0 = Math.min(Math.floor(fy + 1e-9), Math.max(rows - 2, 0));
      const tx = fx - c0;
      const ty = fy - r0;
      let u = 0;
      let v = 0;
      let missing = false;
      for (const [r, c, w] of [
        [r0, c0, (1 - tx) * (1 - ty)],
        [r0, c0 + 1, tx * (1 - ty)],
        [r0 + 1, c0, (1 - tx) * ty],
        [r0 + 1, c0 + 1, tx * ty],
      ] as const) {
        if (w < 1e-9) continue;
        const s = speedAt(r, c);
        const f = fromAt(r, c);
        if (s == null || f == null) {
          missing = true;
          break;
        }
        // Meteorological: `f` is where it blows from, so it goes the other way.
        u -= w * s * Math.sin(f * rad);
        v -= w * s * Math.cos(f * rad);
      }
      if (missing) continue;
      // Towards is a bearing from north; the arrowhead at 0° points east (90°).
      const towards = Math.atan2(u, v) / rad;
      features.push({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [west + i * spacing, north - j * spacing] as [
            number,
            number,
          ],
        },
        properties: {
          speed: Math.round(Math.hypot(u, v) * 10) / 10,
          rotate: (((Math.round(towards) - 90) % 360) + 360) % 360,
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
