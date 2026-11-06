// Which forecast model this device asks Open-Meteo for (`WEATHER_MODELS`).
//
// Device-scoped, in `prefsDb` like the theme: a guest has no account to keep
// it in, and it names no place. Read synchronously so the first forecast of a
// session already asks for the chosen model. A stored id the list no longer
// has reads as best match. Guard: `weatherModelPreference.test.ts`.
import {
  WEATHER_MODEL_DEFAULT,
  isWeatherModelId,
  type WeatherModelId,
} from "@logjam/shared";

import { readPref, writePref } from "../prefsDb";

const KEY = "weatherModel";

export function readWeatherModel(): WeatherModelId {
  const stored = readPref(KEY);
  return isWeatherModelId(stored) ? stored : WEATHER_MODEL_DEFAULT;
}

/** A failed write only means the choice lasts until the app closes. */
export function writeWeatherModel(model: WeatherModelId): void {
  writePref(KEY, model);
}
