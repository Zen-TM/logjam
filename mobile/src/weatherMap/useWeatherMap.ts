import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { WeatherMapFile, WeatherWindFile } from "@logjam/shared";

import { config } from "../config";
import { chooseWeatherRun } from "./weatherMapChoice";
import { fetchWeatherManifest, fetchWeatherWind } from "./weatherMapFeed";
import {
  KEPT_WEATHER_BASE,
  onKeptWeatherChange,
  readKeptWeather,
  readKeptWind,
} from "./weatherMapStorage";

/** A manifest older than this is fetched again when the app comes to the front. */
export const WEATHER_REFRESH_MS = 3_600_000;
/** The bar's "Updated 3 h ago" moves while the app is in front. */
const TICK_MS = 5 * 60_000;

/** The run kept with the saved areas, or null; reads again when one is kept. */
export function useKeptWeather(): WeatherMapFile | null {
  const [kept, setKept] = useState<WeatherMapFile | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      void readKeptWeather().then((file) => live && setKept(file));
    read();
    const unsubscribe = onKeptWeatherChange(read);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return kept;
}

export type WeatherMapState = {
  file: WeatherMapFile | null;
  /** Where the run's files are: `weatherLayerUrl`'s `base`. */
  base: string;
  wind: WeatherWindFile | null;
  /** `loading` until the first answer, then `ready`, or `failed`: none could be had. */
  status: "loading" | "ready" | "failed";
  /** The clock the bar reads, moved every five minutes while in front. */
  now: number;
  retry: () => void;
};

/**
 * The run the overlay draws while `enabled`: the CDN's latest online (fetched
 * when switched on, again on return to the front after an hour, and on
 * regained signal), the run kept with the saved areas offline or when the CDN
 * can't be reached. Nothing polls, and nothing runs while `enabled` is false.
 */
export function useWeatherMap(
  enabled: boolean,
  online: boolean,
  kept: WeatherMapFile | null,
  wantWind: boolean,
): WeatherMapState {
  const [fetched, setFetched] = useState<WeatherMapFile | null>(null);
  const [answered, setAnswered] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  const fetchedAt = useRef(0);

  const ask = `${online}:${attempt}`;
  useEffect(() => {
    if (!enabled || !online) return;
    if (fetched && Date.now() - fetchedAt.current < WEATHER_REFRESH_MS) return;
    let live = true;
    void fetchWeatherManifest().then((got) => {
      if (!live) return;
      if (got) {
        fetchedAt.current = Date.now();
        setFetched(got.file);
        setNow(Date.now());
      }
      setAnswered(ask);
    });
    return () => {
      live = false;
    };
    // `fetched` is read for its age only; its arrival must not fetch again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, online, attempt]);

  // Only while in front: no timer behind a dark screen (ADR 0013).
  useEffect(() => {
    if (!enabled) return;
    // The clock stopped while the overlay was off: bring it up to date.
    const first = setTimeout(() => setNow(Date.now()), 0);
    let tick: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(tick);
      tick = setInterval(() => setNow(Date.now()), TICK_MS);
    };
    if (AppState.currentState === "active") start();
    const app = AppState.addEventListener("change", (state) => {
      clearInterval(tick);
      if (state !== "active") return;
      setNow(Date.now());
      start();
      if (Date.now() - fetchedAt.current >= WEATHER_REFRESH_MS)
        setAttempt((a) => a + 1);
    });
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      app.remove();
    };
  }, [enabled]);

  // Offline there is nothing to wait for, and a run in hand needs no answer.
  const settled = !online || fetched !== null || answered === ask;
  const file = chooseWeatherRun({ enabled, online, settled, fetched, kept });
  const fromCdn = file !== null && file === fetched;

  const [held, setHeld] = useState<{
    path: string;
    fromCdn: boolean;
    wind: WeatherWindFile | null;
  } | null>(null);
  const path = file?.path;
  useEffect(() => {
    if (!enabled || !wantWind || !file) return;
    let live = true;
    void (fromCdn ? fetchWeatherWind(file) : readKeptWind(file)).then(
      (wind) => live && setHeld({ path: file.path, fromCdn, wind }),
    );
    return () => {
      live = false;
    };
    // The run's path names its files; a new object for the same run is the same wind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, wantWind, path, fromCdn]);
  const wind =
    wantWind && held?.path === path && held?.fromCdn === fromCdn
      ? (held?.wind ?? null)
      : null;

  const retry = useCallback(() => {
    fetchedAt.current = 0;
    setAttempt((a) => a + 1);
  }, []);

  return {
    file,
    base: fromCdn ? config.topoCdnBaseUrl : KEPT_WEATHER_BASE,
    wind,
    status: file ? "ready" : settled ? "failed" : "loading",
    now,
    retry,
  };
}
