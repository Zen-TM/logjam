// Fetching the Weather overlay's public files (ADR 0048). Foreground only
// (ADR 0013): the callers are the overlay being switched on, the app returning
// to the front, regained signal and a saved area being downloaded.
//
// PRIVACY: the requests carry no headers and no query, only the files' paths,
// the same for every phone and every place, so our CDN's logs say nothing about
// where anyone looks. Guard: weatherMapFeed.test.ts ("asks the CDN for the
// public file with nothing else sent"). A failure is a state, never a log line
// (a URL would be one); guard: weatherMapFeed.test.ts ("a failure is a state, never a log line").
import {
  WEATHER_MAP,
  parseWeatherMap,
  parseWeatherWind,
  weatherWindUrl,
  type WeatherMapFile,
  type WeatherWindFile,
} from "@logjam/shared";

import { config } from "../config";
import { canRunNow } from "../offline/networkPolicy";
import { isOfflineOnly } from "../offline/offlineOnlyMode";

const TIMEOUT_MS = 15_000;

async function getJson(url: string): Promise<{ text: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok ? { text: await response.text() } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The run on the CDN now, with the text it came as (to keep it as it is), or
 * null for no connection, offline-only mode, a failure or a manifest this
 * build can't draw. Rides the "sync" setting like the gauge file: 4 KB, unless
 * the caller has the user's own answer for mobile data (`allowMetered`, a
 * download they started), which stands in for it.
 */
export async function fetchWeatherManifest(allowMetered?: boolean): Promise<{
  file: WeatherMapFile;
  text: string;
} | null> {
  if (isOfflineOnly() || !(await canRunNow("sync", allowMetered))) return null;
  const got = await getJson(
    `${config.topoCdnBaseUrl}/${WEATHER_MAP.manifestPath}`,
  );
  if (!got) return null;
  try {
    const file = parseWeatherMap(JSON.parse(got.text));
    return file ? { file, text: got.text } : null;
  } catch {
    return null;
  }
}

/** The run's wind arrows from the CDN, or null. */
export async function fetchWeatherWind(
  file: WeatherMapFile,
): Promise<WeatherWindFile | null> {
  if (isOfflineOnly() || !(await canRunNow("sync"))) return null;
  const got = await getJson(weatherWindUrl(config.topoCdnBaseUrl, file));
  try {
    return got ? parseWeatherWind(JSON.parse(got.text)) : null;
  } catch {
    return null;
  }
}
