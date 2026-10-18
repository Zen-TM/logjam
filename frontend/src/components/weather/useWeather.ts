import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  fetchForecast,
  weatherCell,
  type WeatherForecast,
} from "@logjam/shared";

export type WeatherState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; forecast: WeatherForecast };

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
 * The forecast for a spot (ADR 0035). Nothing is asked until `load` is called
 * from a press, and nothing is kept: closing the view drops the forecast. A
 * failure is only ever `failed`, never the error, which could carry the cell.
 */
export function useWeather(
  point: { latitude: number; longitude: number },
  elevationM: number | null,
): { state: WeatherState; load: () => void } {
  const [state, setState] = useState<WeatherState>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);
  const { latitude, longitude } = point;

  useEffect(() => () => controller.current?.abort(), []);

  const load = useCallback(() => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState({ status: "loading" });
    fetchForecast(weatherCell({ latitude, longitude }, elevationM), {
      signal: abort.signal,
    }).then(
      (forecast) => {
        if (!abort.signal.aborted) setState({ status: "ready", forecast });
      },
      () => {
        if (!abort.signal.aborted) setState({ status: "failed" });
      },
    );
  }, [latitude, longitude, elevationM]);

  return { state, load };
}
