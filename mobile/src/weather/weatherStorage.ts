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

export async function cacheForecast(forecast: WeatherForecast): Promise<void> {
  await FileSystem.makeDirectoryAsync(WEATHER_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(
    FILE,
    JSON.stringify(withForecast(await readCache(), forecast)),
  );
}
