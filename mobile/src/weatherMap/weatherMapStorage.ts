// The latest weather run kept on this phone with the saved areas (ADR 0048):
// ONE copy for all of them, laid out as the CDN lays it out under
// `WEATHER_MAP_DIR`, so `weatherLayerUrl(KEPT_WEATHER_BASE, ...)` names its
// files. The manifest is written last: a run with a manifest is whole, and a
// run folder without one is a download that stopped. The files are public and
// the same for everyone; they are wiped anyway because every store joins the
// wipe (ADR 0006).
import * as FileSystem from "expo-file-system/legacy";
import {
  WEATHER_MAP,
  parseWeatherMap,
  parseWeatherWind,
  type WeatherMapFile,
  type WeatherWindFile,
  weatherWindUrl,
} from "@logjam/shared";

import { WEATHER_MAP_DIR } from "../offline/localStores";
import { bumpWeatherMapEpoch } from "./weatherMapEpoch";

/** `weatherLayerUrl`'s `base` for the kept copy. */
export const KEPT_WEATHER_BASE = WEATHER_MAP_DIR.replace(/\/$/, "");
const MANIFEST = `${KEPT_WEATHER_BASE}/${WEATHER_MAP.manifestPath}`;
const RUNS = `${KEPT_WEATHER_BASE}/${WEATHER_MAP.prefix}runs/`;

/** Sends nothing: the manifest of the kept run, or null when there is none. */
export async function readKeptWeather(): Promise<WeatherMapFile | null> {
  try {
    return parseWeatherMap(
      JSON.parse(await FileSystem.readAsStringAsync(MANIFEST)),
    );
  } catch {
    return null;
  }
}

/** Sends nothing: the kept run's wind arrows, or null. */
export async function readKeptWind(
  file: WeatherMapFile,
): Promise<WeatherWindFile | null> {
  try {
    return parseWeatherWind(
      JSON.parse(
        await FileSystem.readAsStringAsync(
          weatherWindUrl(KEPT_WEATHER_BASE, file),
        ),
      ),
    );
  } catch {
    return null;
  }
}

// A wipe bumps the epoch so a download begun before it cannot write after it
// (the pattern of gauges/gaugeStorage.ts).
let job: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

/** The download in flight, so a wipe can wait for it to stop. */
export function holdForWipe(running: Promise<unknown>): void {
  job = running;
}

/** Called by the sign-out wipe: the download stops at its next file. */
export async function stopWeatherMapForWipe(): Promise<void> {
  bumpWeatherMapEpoch();
  await job.catch(() => {});
}

/** Runs when a run has been kept. Returns the unsubscribe. */
export function onKeptWeatherChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function announceKeptWeather(): void {
  for (const listener of listeners) listener();
}

/** Writes the manifest, which makes the run in its folder the kept one. */
export function writeKeptManifest(text: string): Promise<void> {
  return FileSystem.writeAsStringAsync(MANIFEST, text);
}

/** The folder of one run's file, created. */
export function makeFolderFor(uri: string): Promise<void> {
  return FileSystem.makeDirectoryAsync(uri.slice(0, uri.lastIndexOf("/")), {
    intermediates: true,
  });
}

/** Deletes every run folder but `keep`'s: an older run, or a download that stopped. */
export async function dropRunsExcept(
  keep: WeatherMapFile | null,
): Promise<void> {
  const names = await FileSystem.readDirectoryAsync(RUNS).catch(() => []);
  const kept = keep?.path.replace(/^runs\/|\/$/g, "");
  for (const name of names)
    if (name !== kept)
      await FileSystem.deleteAsync(`${RUNS}${name}`, { idempotent: true });
}
