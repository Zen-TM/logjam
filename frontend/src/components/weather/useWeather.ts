import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  WEATHER_MODEL_DEFAULT,
  fetchForecast,
  isWeatherModelId,
  weatherCell,
  type WeatherForecast,
  type WeatherModelId,
} from "@logjam/shared";
import { useStoredState } from "../../useStoredState";

const MODEL_KEY = "logjam.weatherModel";

export type WeatherState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; forecast: WeatherForecast; now: number };

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
      fetchForecast(weatherCell({ latitude, longitude }, elevationM, which), {
        signal: abort.signal,
      }).then(
        (forecast) => {
          if (!abort.signal.aborted)
            setState({ status: "ready", forecast, now: Date.now() });
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
