// The forecast for one cell: the phone's kept copy at once, a fresh one only
// when `refresh` is called, which is only ever on a press (ADR 0038). The same
// press fetches the rain gauge file, the same for everyone, and the gauges
// near the spot are picked here, on the phone (ADR 0047).
//
// PRIVACY: a failure is a state, never a log line: the error could carry the
// cell.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchForecast,
  nearbyRain,
  weatherCell,
  weatherCellKey,
  type PastRain,
  type RainFile,
  type WeatherCell,
  type WeatherForecast,
  type WeatherModelId,
} from "@logjam/shared";

import { refreshRain } from "../gauges/gaugeFeed";
import { readCachedRain } from "../gauges/gaugeStorage";
import { useConnectivity } from "../map/connectivity";
import { isOfflineOnly } from "../offline/offlineOnlyMode";
import {
  cacheForecast,
  readCachedForecast,
  weatherEpoch,
} from "./weatherStorage";
import { mayFetch } from "./weatherState";
import { readWeatherModel, writeWeatherModel } from "./weatherModelPreference";

export type WeatherStatus = "idle" | "loading" | "failed";

export type Weather = {
  forecast: WeatherForecast | null;
  status: WeatherStatus;
  /** Online, and not in "Simulating offline mode". */
  canFetch: boolean;
  /** When the forecast was last read or fetched: what its age counts from. */
  now: number;
  refresh: () => void;
  /** The forecast model asked for: a device preference, kept per cell. */
  model: WeatherModelId;
  /** Remembers the model and asks for its forecast, on the press that chose it. */
  chooseModel: (model: WeatherModelId) => void;
  /** The rain gauges near the spot, or null with no gauge file on the phone. */
  rain: PastRain | null;
};

type Held = {
  key: string;
  forecast: WeatherForecast | null;
  status: WeatherStatus;
  now: number;
};

export function useWeather(
  point: { latitude: number; longitude: number },
  elevationM: number | null,
  allowNetwork: boolean,
): Weather {
  const canFetch = useConnectivity(!allowNetwork) === "online";
  const [model, setModel] = useState(readWeatherModel);
  const cell = useMemo(
    () => weatherCell(point, elevationM, model),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the point's two numbers are the identity
    [point.latitude, point.longitude, elevationM, model],
  );
  const key = weatherCellKey(cell);
  // Kept under its cell's key, so a state held for another cell reads as none.
  const [held, setHeld] = useState<Held>(() => ({
    key,
    forecast: null,
    status: "idle",
    now: Date.now(),
  }));
  const here: Held =
    held.key === key
      ? held
      : { key, forecast: null, status: "idle", now: held.now };
  const inFlight = useRef<AbortController | null>(null);
  const [rainFile, setRainFile] = useState<RainFile | null>(null);

  useEffect(() => {
    let live = true;
    // A press's fetch can beat the read: keep whichever landed first.
    readCachedRain()
      .then((kept) => live && setRainFile((f) => f ?? kept))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    readCachedForecast(cell)
      .then((kept) => {
        if (!current || !kept) return;
        setHeld((h) =>
          h.key === key && h.forecast
            ? h
            : {
                key,
                forecast: kept,
                // A press can beat the read: keep its loading or failed.
                status: h.key === key ? h.status : "idle",
                now: Date.now(),
              },
        );
      })
      .catch(() => {});
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the cell
  }, [key]);

  // Not with the read above: choosing a model changes the key and asks in the
  // same press, and that ask must outlive the key's change.
  useEffect(() => () => inFlight.current?.abort(), []);

  const fetchCell = useCallback(
    (target: WeatherCell) => {
      const key = weatherCellKey(target);
      if (!mayFetch({ canFetch, offlineOnlyNow: isOfflineOnly() })) return;
      const epoch = weatherEpoch();
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setHeld((h) => ({
        ...(h.key === key ? h : { forecast: null, now: h.now }),
        key,
        status: "loading",
      }));
      refreshRain()
        .then((fresh) => fresh && setRainFile(fresh))
        .catch(() => {});
      fetchForecast(target, { signal: controller.signal })
        .then((fresh) => {
          if (controller.signal.aborted) return;
          setHeld({ key, forecast: fresh, status: "idle", now: Date.now() });
          cacheForecast(fresh, epoch).catch(() => {});
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setHeld((h) => ({ ...h, key, status: "failed" }));
        });
    },
    [canFetch],
  );

  const refresh = useCallback(() => fetchCell(cell), [fetchCell, cell]);
  const chooseModel = useCallback(
    (next: WeatherModelId) => {
      setModel(next);
      writeWeatherModel(next);
      fetchCell(weatherCell(point, elevationM, next));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the point's two numbers are the identity
    [fetchCell, point.latitude, point.longitude, elevationM],
  );

  const rain = useMemo(
    () =>
      rainFile && here.forecast
        ? nearbyRain(
            rainFile,
            point,
            here.forecast.past.days.map((day) => day.date),
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the point's two numbers are the identity
    [rainFile, here.forecast, point.latitude, point.longitude],
  );

  return {
    rain,
    model,
    chooseModel,
    forecast: here.forecast,
    status: here.status,
    canFetch,
    now: here.now,
    refresh,
  };
}
