// What the bar over the map says while Weather is on: the fetch state and the
// words, on top of shared `weatherShown`, which decides the step, the clamp
// and the out-of-date and missing cases for both clients.
import {
  MAP_TERRAIN,
  weatherScale,
  weatherShown,
  type WeatherPick,
  type WeatherLayerKey,
  type WeatherMapFile,
  type WeatherTotalKey,
} from "@logjam/shared";

export type WeatherBarModel =
  | { kind: "loading"; text: string }
  | { kind: "failed"; text: string; canRetry: boolean }
  | { kind: "outOfDate"; text: string }
  /** A total this run leaves out: failed words, and the card's rail of
   *  periods, so another can be picked. Nothing to retry until a newer run. */
  | {
      kind: "missing";
      text: string;
      layer: WeatherLayerKey;
      totals: WeatherTotalKey[];
    }
  | {
      kind: "ready";
      /** What Play is tied to: a new layer opens paused. */
      layer: WeatherLayerKey;
      /** The totals the run has (the card's rail disables the rest). */
      totals: WeatherTotalKey[];
      title: string;
      /** The step or window on the map, and the run's age. */
      detail: string;
      /** The colour scale's stops (shared `weatherScale`). */
      scale: { label: string; colour: string }[];
      /** For a stepped layer: the steps the scrubber spans and the one shown. */
      scrub: {
        first: number;
        last: number;
        step: number;
        value: string;
      } | null;
    };

const copy = MAP_TERRAIN.copy;

export function weatherBarModel(input: {
  status: "loading" | "ready" | "failed";
  file: WeatherMapFile | null;
  layer: WeatherLayerKey;
  /** The scrubber's pick, or null for where it starts. */
  /** Counts only in the run it was made in (shared `weatherShown`). */
  picked: WeatherPick | null;
  now: number;
  online: boolean;
}): WeatherBarModel {
  const { status, file, now } = input;
  if (status === "loading" || (status === "ready" && !file))
    return { kind: "loading", text: copy.weatherLoading };
  if (status === "failed" || !file)
    return { kind: "failed", text: copy.weatherFailed, canRetry: input.online };
  const shown = weatherShown({
    file,
    layer: input.layer,
    picked: input.picked,
    now,
  });
  if (shown.kind === "outOfDate")
    return { kind: "outOfDate", text: copy.weatherOutOfDate };
  if (shown.kind !== "ready")
    return {
      kind: "missing",
      text: copy.weatherFailed,
      layer: input.layer,
      totals: file.totals,
    };
  const { layer, step, first, last } = shown;
  return {
    kind: "ready",
    layer: layer.key,
    totals: file.totals,
    title: `${layer.label} (${layer.unit})`,
    detail: `${shown.shown} · ${shown.age}`,
    scale: weatherScale(layer.key),
    scrub: step === null ? null : { first, last, step, value: shown.shown },
  };
}

/** The archive the map should read, or null when the bar draws nothing. */
export function weatherDrawnStep(model: WeatherBarModel): number | null {
  return model.kind === "ready" ? (model.scrub?.step ?? 0) : null;
}
