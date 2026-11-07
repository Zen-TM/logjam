import {
  weatherShown,
  type WeatherLayerKey,
  type WeatherMapFile,
  type WeatherPick,
  type WeatherShown,
} from "@logjam/shared";

export type { WeatherPick };

/** The manifest as the hook holds it. */
export type WeatherMapState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; file: WeatherMapFile };

/** What the bar says and the map draws. */
export type WeatherView =
  | { kind: "off" | "loading" | "failed" | "missing" | "outOfDate" }
  | Extract<WeatherShown, { kind: "ready" }>;

/**
 * `weatherShown`'s decision (shared) as this bar's states. A total the run
 * lacks is `missing`: failed, with nothing to try again until a newer run.
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
  return weatherShown({ file: state.file, layer: layerKey, picked: pick, now });
}
