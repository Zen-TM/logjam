import type { WeatherMapFile } from "@logjam/shared";

/**
 * Which run to draw: the CDN's when online and it answered, else the kept one
 * (offline, or the CDN could not be reached), else none. Online it waits for
 * the CDN's first answer rather than drawing the kept run and then swapping.
 * Guard: weatherMapChoice.test.ts.
 */
export function chooseWeatherRun(state: {
  enabled: boolean;
  online: boolean;
  settled: boolean;
  fetched: WeatherMapFile | null;
  kept: WeatherMapFile | null;
}): WeatherMapFile | null {
  if (!state.enabled) return null;
  if (!state.online) return state.kept;
  return state.fetched ?? (state.settled ? state.kept : null);
}
