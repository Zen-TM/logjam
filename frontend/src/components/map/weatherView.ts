import {
  isWeatherTotal,
  weatherAge,
  weatherLayer,
  weatherLayerUrl,
  weatherShownLabel,
  weatherStepAt,
  type WeatherLayer,
  type WeatherLayerKey,
  type WeatherMapFile,
  type WeatherWindFile,
} from "@logjam/shared";

/** The manifest as the hook holds it. */
export type WeatherMapState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; file: WeatherMapFile };

/** A manifest this old is asked for again when Weather is next turned on. */
export const WEATHER_MANIFEST_MAX_AGE_MS = 3_600_000;

/** What the bar says and the map draws. */
export type WeatherView =
  | { kind: "off" | "loading" | "failed" | "outOfDate" }
  | {
      kind: "ready";
      layer: WeatherLayer;
      /** Index into the manifest's steps; a total has no step. */
      step: number | null;
      /** The scrubber's reach; absent for a total. */
      first: number;
      last: number;
      shown: string;
      age: string;
      /** The archive to draw, under `base`. */
      url: string;
    };

/**
 * What Weather shows: `chosen` is the step the user picked (null until they
 * do), clamped to the steps still to come. A run whose every step is past is
 * never drawn as today's. A total the run lacks reads as failed: a newer run
 * may have it.
 */
export function weatherView(input: {
  on: boolean;
  state: WeatherMapState;
  layerKey: WeatherLayerKey;
  chosen: number | null;
  now: number;
  base: string;
}): WeatherView {
  const { on, state, layerKey, chosen, now, base } = input;
  if (!on) return { kind: "off" };
  if (state.status !== "ready") return { kind: state.status };
  const { file } = state;
  const layer = weatherLayer(layerKey);
  const total = isWeatherTotal(layer);
  const first = total ? 0 : weatherStepAt(file, now);
  if (first === null) return { kind: "outOfDate" };
  const last = total ? 0 : file.steps.length - 1;
  const step = total ? 0 : Math.min(Math.max(chosen ?? first, first), last);
  const url = weatherLayerUrl(base, file, layer.key, step);
  if (!url) return { kind: "failed" };
  return {
    kind: "ready",
    layer,
    step: total ? null : step,
    first,
    last,
    shown: weatherShownLabel(file, layer.key, step, now),
    age: weatherAge(Date.parse(file.built), now),
    url,
  };
}

/** `wind.json` is our own file, but a bad one must draw no arrows, not throw. */
export function parseWindFile(raw: unknown): WeatherWindFile | null {
  const w = raw as Partial<WeatherWindFile> | null;
  if (
    !w ||
    typeof w !== "object" ||
    ![w.west, w.north, w.step, w.columns, w.rows].every(Number.isFinite) ||
    !Array.isArray(w.steps) ||
    !w.steps.every((s) => s && Array.isArray(s.speed) && Array.isArray(s.from))
  )
    return null;
  return w as WeatherWindFile;
}
