import * as FileSystem from "expo-file-system/legacy";
import {
  weatherCellKey,
  type WeatherCell,
  type WeatherForecast,
} from "@logjam/shared";

import { WEATHER_DIR } from "../offline/localStores";
import {
  parseWeatherCache,
  withForecast,
  type WeatherCache,
} from "./weatherCache";

const FILE = `${WEATHER_DIR}forecasts.json`;

async function readCache(): Promise<WeatherCache> {
  try {
    return parseWeatherCache(await FileSystem.readAsStringAsync(FILE));
  } catch {
    return {};
  }
}

/** Sends nothing: it only reads the phone's own file. */
export async function readCachedForecast(
  cell: WeatherCell,
): Promise<WeatherForecast | null> {
  return (await readCache())[weatherCellKey(cell)] ?? null;
}

// Writes run one at a time (two cells' fetches would otherwise each read the
// file and the second write drop the first's entry), and a wipe bumps the
// epoch so a fetch begun before it cannot re-create the directory after it.
let epoch = 0;
let tail: Promise<void> = Promise.resolve();

/** Read when a fetch begins; hand back to `cacheForecast` when it lands. */
export const weatherEpoch = (): number => epoch;

/** Called by the sign-out wipe: pending writes finish, later ones are dropped. */
export function stopWeatherForWipe(): Promise<void> {
  epoch += 1;
  return tail;
}

export function cacheForecast(
  forecast: WeatherForecast,
  fetchEpoch: number,
): Promise<void> {
  tail = tail.then(async () => {
    if (fetchEpoch !== epoch) return;
    await FileSystem.makeDirectoryAsync(WEATHER_DIR, { intermediates: true });
    await FileSystem.writeAsStringAsync(
      FILE,
      JSON.stringify(withForecast(await readCache(), forecast)),
    );
  });
  // The next write runs whether or not this one failed.
  const done = tail;
  tail = tail.catch(() => {});
  return done;
}
