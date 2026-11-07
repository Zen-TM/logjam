import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WEATHER_MAP,
  parseWeatherMap,
  weatherWindUrl,
  windArrows,
  type WeatherLayerKey,
  type WeatherWindFile,
} from "@logjam/shared";
import {
  WEATHER_MANIFEST_MAX_AGE_MS,
  parseWindFile,
  weatherView,
  type WeatherMapState,
} from "./weatherView";

/** Every user reads the same files from our own origin (ADR 0048). */
const BASE = window.location.origin;

/** How long a dragged scrubber waits before the map is asked for its step's
 *  archive, so a drag across the week asks for the few it lingers on. */
const DRAW_AFTER_MS = 150;
/** The bar's clock and the step it starts on, kept to the minute-ish. */
const CLOCK_MS = 300_000;

/**
 * The Weather overlay's files while it is on: the manifest, fetched when it is
 * turned on and again then if older than an hour (nothing polls), and the
 * wind arrows' file, once per run and only for a layer that draws them. A
 * failure is only ever `failed`; nothing is logged.
 *
 * `view` is what the bar shows at once; `drawn` is the same a moment behind the
 * scrubber, which is what the map draws.
 */
export function useWeatherMap(on: boolean, layerKey: WeatherLayerKey) {
  const [state, setState] = useState<WeatherMapState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [pick, setPick] = useState<{ path: string; step: number } | null>(null);
  const [drawnPick, setDrawnPick] = useState(pick);
  const [wind, setWind] = useState<{
    path: string;
    data: WeatherWindFile | null;
  } | null>(null);
  const loadedAt = useRef(0);

  useEffect(() => {
    if (!on) return;
    if (Date.now() - loadedAt.current < WEATHER_MANIFEST_MAX_AGE_MS) return;
    const abort = new AbortController();
    setState((prev) =>
      prev.status === "ready" ? prev : { status: "loading" },
    );
    fetch(`${BASE}/${WEATHER_MAP.manifestPath}`, { signal: abort.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((raw: unknown) => {
        const file = parseWeatherMap(raw);
        if (!file) throw new Error();
        loadedAt.current = Date.now();
        setNow(Date.now());
        setState({ status: "ready", file });
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        loadedAt.current = 0;
        setState((prev) =>
          prev.status === "ready" ? prev : { status: "failed" },
        );
      });
    return () => abort.abort();
  }, [on, attempt]);

  useEffect(() => {
    if (!on) return;
    // At once too: a turn-on starts from the clock as it is, not as it was.
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, CLOCK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [on]);

  useEffect(() => {
    const timer = setTimeout(() => setDrawnPick(pick), DRAW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [pick]);

  const file = state.status === "ready" ? state.file : null;
  const path = file?.path;
  const chosenIn = (p: typeof pick) => (p && p.path === path ? p.step : null);
  const base = { on, state, layerKey, now, base: BASE };
  const view = weatherView({ ...base, chosen: chosenIn(pick) });
  const drawn = weatherView({ ...base, chosen: chosenIn(drawnPick) });

  const drawnStep = drawn.kind === "ready" ? drawn.step : null;
  const wantsWind =
    on && file !== null && drawn.kind === "ready" && !!drawn.layer.arrows;
  useEffect(() => {
    if (!wantsWind || !file || wind?.path === file.path) return;
    const abort = new AbortController();
    const forPath = file.path;
    fetch(weatherWindUrl(BASE, file), { signal: abort.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((raw: unknown) =>
        setWind({ path: forPath, data: parseWindFile(raw) }),
      )
      .catch(() => {
        if (!abort.signal.aborted) setWind({ path: forPath, data: null });
      });
    return () => abort.abort();
  }, [wantsWind, file, wind?.path]);

  const arrows = useMemo(
    () =>
      wantsWind && drawnStep !== null && wind && wind.path === path && wind.data
        ? windArrows(wind.data, drawnStep)
        : null,
    [wantsWind, drawnStep, wind, path],
  );

  const setStep = useCallback(
    (step: number) => path && setPick({ path, step }),
    [path],
  );

  return {
    view,
    drawn,
    arrows,
    setStep,
    retry: () => setAttempt((n) => n + 1),
  };
}
