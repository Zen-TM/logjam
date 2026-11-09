import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WEATHER_MAP,
  parseWeatherMap,
  parseWeatherWind,
  weatherLayerUrl,
  weatherWindUrl,
  windArrows,
  type WeatherLayerKey,
  type WeatherWindFile,
} from "@logjam/shared";
import {
  weatherView,
  type WeatherMapState,
  type WeatherPick,
} from "./weatherView";

/** Every user reads the same files from our own origin (ADR 0048). */
const BASE = window.location.origin;

/**
 * The Weather overlay's files while it is on: the manifest, fetched when it is
 * turned on, and again then or when the tab comes back to the front if it is
 * older than `WEATHER_MAP.refreshAfterMs` (nothing polls; guard:
 * useWeatherMap.test.tsx, "never again by itself"), and the wind
 * arrows' file, once per run and only for a layer that draws them. A failure is
 * only ever `failed`; nothing is logged.
 *
 * What is drawn is `settled`, the step the bar has rested on: the bar holds the
 * step while it is dragged, so a notch re-renders the bar and not the app.
 */
export function useWeatherMap(on: boolean, layerKey: WeatherLayerKey) {
  const [state, setState] = useState<WeatherMapState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [settled, setSettled] = useState<WeatherPick | null>(null);
  const [wind, setWind] = useState<{
    path: string;
    data: WeatherWindFile | null;
  } | null>(null);
  const loadedAt = useRef(0);
  // The run whose archive went missing and when its manifest was asked for
  // again: a second miss for that run within the hour is failed, a later one
  // (a passing 404 long ago) asks again.
  const goneFor = useRef<{ path: string; at: number } | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!on) return;
    if (Date.now() - loadedAt.current < WEATHER_MAP.refreshAfterMs) return;
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
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - loadedAt.current >= WEATHER_MAP.refreshAfterMs
      )
        setAttempt((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [on]);

  useEffect(() => {
    if (!on) return;
    // At once too: a turn-on starts from the clock as it is, not as it was.
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, WEATHER_MAP.clockMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [on]);

  const file = state.status === "ready" ? state.file : null;
  const path = file?.path;
  const drawn = weatherView({ on, state, layerKey, pick: settled, now });
  const drawnUrl =
    file && drawn.kind === "ready"
      ? weatherLayerUrl(BASE, file, drawn.layer.key, drawn.step ?? 0)
      : null;

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
        setWind({ path: forPath, data: parseWeatherWind(raw) }),
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

  /** An archive the manifest names is gone (the job pruned that run): drop the
   *  manifest and ask once for the current one. The same run twice means it is
   *  the current one, and it is failed. */
  const archiveGone = useCallback(() => {
    const s = stateRef.current;
    if (s.status !== "ready") return;
    stateRef.current = { status: "loading" };
    loadedAt.current = 0;
    const at = Date.now();
    const gone = goneFor.current;
    if (
      gone?.path === s.file.path &&
      at - gone.at < WEATHER_MAP.refreshAfterMs
    ) {
      stateRef.current = { status: "failed" };
      setState(stateRef.current);
      return;
    }
    goneFor.current = { path: s.file.path, at };
    setState(stateRef.current);
    setAttempt((n) => n + 1);
  }, []);

  return {
    state,
    now,
    drawnUrl,
    arrows,
    settled,
    settle: setSettled,
    archiveGone,
    retry: () => setAttempt((n) => n + 1),
  };
}
