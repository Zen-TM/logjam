// The forecast for one cell: the phone's kept copy at once, a fresh one only
// when `refresh` is called, which is only ever on a press (ADR 0038).
//
// PRIVACY: a failure is a state, never a log line: the error could carry the
// cell.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchForecast,
  weatherCell,
  weatherCellKey,
  type WeatherForecast,
} from "@logjam/shared";

import { useConnectivity } from "../map/connectivity";
import { isOfflineOnly } from "../offline/offlineOnlyMode";
import {
  cacheForecast,
  readCachedForecast,
  weatherEpoch,
} from "./weatherStorage";
import { mayFetch } from "./weatherState";

export type WeatherStatus = "idle" | "loading" | "failed";

export type Weather = {
  forecast: WeatherForecast | null;
  status: WeatherStatus;
  /** Online, and not in "Simulating offline mode". */
  canFetch: boolean;
  /** When the forecast was last read or fetched: what its age counts from. */
  now: number;
  refresh: () => void;
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
  const cell = useMemo(
    () => weatherCell(point, elevationM),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the point's two numbers are the identity
    [point.latitude, point.longitude, elevationM],
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
      inFlight.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the cell
  }, [key]);

  const refresh = useCallback(() => {
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
    fetchForecast(cell, { signal: controller.signal })
      .then((fresh) => {
        if (controller.signal.aborted) return;
        setHeld({ key, forecast: fresh, status: "idle", now: Date.now() });
        cacheForecast(fresh, epoch).catch(() => {});
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setHeld((h) => ({ ...h, key, status: "failed" }));
      });
  }, [canFetch, cell, key]);

  return {
    forecast: here.forecast,
    status: here.status,
    canFetch,
    now: here.now,
    refresh,
  };
}
