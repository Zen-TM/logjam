import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  RAIN_PATH,
  WEATHER_MODEL_DEFAULT,
  fetchForecast,
  isWeatherModelId,
  nearbyRain,
  parseRainFile,
  weatherCell,
  type PastRain,
  type WeatherForecast,
  type WeatherModelId,
} from "@logjam/shared";
import { useStoredState } from "../../useStoredState";

const MODEL_KEY = "logjam.weatherModel";

export type WeatherState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed" }
  | {
      status: "ready";
      forecast: WeatherForecast;
      now: number;
      /** The gauges near the spot, or null when their file couldn't be had. */
      rain: PastRain | null;
    };

/** How long the forecast waits for the gauge file, as Logjam GPS's fetch. */
export const RAIN_WAIT_MS = 15_000;

/** The public rain gauge file (ADR 0047), or null on any failure or after
 *  `RAIN_WAIT_MS`: the past days then show the model's figures, as they did
 *  before gauges, and a stalled file holds up the forecast for at most
 *  `RAIN_WAIT_MS`. */
function fetchRain(signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), RAIN_WAIT_MS);
  });
  const file = fetch(`/${RAIN_PATH}`, { signal })
    .then((res) => (res.ok ? res.json() : null))
    .then(parseRainFile, () => null);
  return Promise.race([file, late]).finally(() => clearTimeout(timer));
}

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * The forecast for a spot (ADR 0038). Nothing is asked until `load` is called
 * from a press, and nothing is kept: closing the view drops the forecast. A
 * failure is only ever `failed`, never the error, which could carry the cell.
 * The same press fetches the rain gauge file, the same for everyone, and the
 * gauges near the spot are picked here (ADR 0047).
 *
 * The model is a per-device preference, read by every view that shows a
 * forecast. Choosing one asks again at once: the press that picked it is the
 * press that asks, and the old model's figures are dropped for `loading`.
 */
export function useWeather(
  point: { latitude: number; longitude: number },
  elevationM: number | null,
): {
  state: WeatherState;
  load: () => void;
  model: WeatherModelId;
  chooseModel: (model: WeatherModelId) => void;
} {
  const [state, setState] = useState<WeatherState>({ status: "idle" });
  const [model, setModel] = useStoredState<WeatherModelId>(
    MODEL_KEY,
    WEATHER_MODEL_DEFAULT,
    undefined,
    isWeatherModelId,
  );
  const controller = useRef<AbortController | null>(null);
  const { latitude, longitude } = point;

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(
    (which: WeatherModelId) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setState({ status: "loading" });
      Promise.all([
        fetchForecast(weatherCell({ latitude, longitude }, elevationM, which), {
          signal: abort.signal,
        }),
        fetchRain(abort.signal),
      ]).then(
        ([forecast, file]) => {
          if (abort.signal.aborted) return;
          const dates = forecast.past.days.map((day) => day.date);
          setState({
            status: "ready",
            forecast,
            now: Date.now(),
            rain: file && nearbyRain(file, { latitude, longitude }, dates),
          });
        },
        () => {
          if (!abort.signal.aborted) setState({ status: "failed" });
        },
      );
    },
    [latitude, longitude, elevationM],
  );

  const chooseModel = useCallback(
    (next: WeatherModelId) => {
      setModel(next);
      run(next);
    },
    [run, setModel],
  );

  return { state, load: () => run(model), model, chooseModel };
}
