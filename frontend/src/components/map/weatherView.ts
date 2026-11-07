import {
  weatherShown,
  type WeatherLayer,
  type WeatherLayerKey,
  type WeatherMapFile,
} from "@logjam/shared";

/** The manifest as the hook holds it. */
export type WeatherMapState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; file: WeatherMapFile };

/** The step the user picked, for the run it was picked in. */
export type WeatherPick = { path: string; step: number };

/** What the bar says and the map draws. */
export type WeatherView =
  | { kind: "off" | "loading" | "failed" | "outOfDate" }
  | {
      kind: "ready";
      layer: WeatherLayer;
      /** Index into the manifest's steps; a total has no step. */
      step: number | null;
      /** The scrubber's reach; both 0 for a total. */
      first: number;
      last: number;
      shown: string;
      age: string;
    };

/**
 * `weatherShown`'s decision (shared) as this bar's states. `pick` counts only
 * for the run it was made in. A total the run lacks reads as failed: a newer
 * run may have it.
 */
export function weatherView(input: {
  on: boolean;
  state: WeatherMapState;
  layerKey: WeatherLayerKey;
  pick: WeatherPick | null;
  now: number;
}): WeatherView {
  const { on, state, layerKey, pick, now } = input;
  if (!on) return { kind: "off" };
  if (state.status !== "ready") return { kind: state.status };
  const { file } = state;
  const picked = pick && pick.path === file.path ? pick.step : null;
  const shown = weatherShown({ file, layer: layerKey, picked, now });
  if (shown.kind === "ready") return shown;
  return { kind: shown.kind === "missing" ? "failed" : "outOfDate" };
}
