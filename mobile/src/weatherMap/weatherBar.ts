// What the bar over the map says while Weather is on, decided apart from the
// view so each state has a test (shared weatherMap.ts has the labels, the
// weather contract the words). One function for the layer, the step and the
// run's state: the same words as Logjam Web's bar.
import {
  MAP_TERRAIN,
  isWeatherTotal,
  weatherAge,
  weatherLayer,
  weatherShownLabel,
  weatherStepAt,
  type WeatherLayerKey,
  type WeatherMapFile,
  type WeatherTotalKey,
} from "@logjam/shared";

export type WeatherBarModel =
  | { kind: "loading"; text: string }
  | { kind: "failed"; text: string; canRetry: boolean }
  | { kind: "outOfDate"; text: string }
  | {
      kind: "ready";
      title: string;
      /** The step or window on the map, and the run's age. */
      detail: string;
      /** For a stepped layer: the steps the scrubber spans and the one shown. */
      scrub: {
        first: number;
        last: number;
        step: number;
        value: string;
      } | null;
    };

const copy = MAP_TERRAIN.copy;

/** `step` held inside what the scrubber spans: an old pick never indexes past a new run. */
export function clampStep(step: number, first: number, last: number): number {
  return Math.min(last, Math.max(first, Math.round(step)));
}

export function weatherBarModel(input: {
  status: "loading" | "ready" | "failed";
  file: WeatherMapFile | null;
  layer: WeatherLayerKey;
  /** The scrubber's pick, or null for where it starts. */
  picked: number | null;
  now: number;
  online: boolean;
}): WeatherBarModel {
  const { status, file, now } = input;
  if (status === "loading" || (status === "ready" && !file))
    return { kind: "loading", text: copy.weatherLoading };
  if (status === "failed" || !file)
    return { kind: "failed", text: copy.weatherFailed, canRetry: input.online };
  const layer = weatherLayer(input.layer);
  const age = weatherAge(Date.parse(file.built), now);
  const title = `${layer.label} (${layer.unit})`;
  if (isWeatherTotal(layer)) {
    // A total this run leaves out (an hour no model run held) draws nothing.
    if (!file.totals.includes(layer.key as WeatherTotalKey))
      return { kind: "failed", text: copy.weatherFailed, canRetry: false };
    return {
      kind: "ready",
      title,
      detail: `${weatherShownLabel(file, layer.key, 0, now)} · ${age}`,
      scrub: null,
    };
  }
  const first = weatherStepAt(file, now);
  // Every step is past: a run that old is never drawn as today's.
  if (first === null) return { kind: "outOfDate", text: copy.weatherOutOfDate };
  const last = file.steps.length - 1;
  const step = clampStep(input.picked ?? first, first, last);
  const value = weatherShownLabel(file, layer.key, step, now);
  return {
    kind: "ready",
    title,
    detail: `${value} · ${age}`,
    scrub: { first, last, step, value },
  };
}

/** The archive the map should read, or null when the bar draws nothing. */
export function weatherDrawnStep(model: WeatherBarModel): number | null {
  return model.kind === "ready" ? (model.scrub?.step ?? 0) : null;
}
