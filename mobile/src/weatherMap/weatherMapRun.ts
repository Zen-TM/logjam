// What one run of the Weather overlay is made of, as the manifest names it
// (shared weatherMap.ts, ADR 0048): the same list for the CDN and for the
// phone's kept copy, so the two cannot disagree about a file's place.
import {
  WEATHER_LAYERS,
  isWeatherTotal,
  weatherLayerUrl,
  weatherWindUrl,
  type WeatherMapFile,
  type WeatherWindFile,
} from "@logjam/shared";

/**
 * Every file of the run under `base`: each stepped field at each step, each
 * total the run has, and the wind arrows. The same order for any `base`, so
 * `weatherRunUrls(cdn, file)[i]` is kept as `weatherRunUrls(kept, file)[i]`.
 * Guard: weatherMapRun.test.ts.
 */
export function weatherRunUrls(base: string, file: WeatherMapFile): string[] {
  const urls = WEATHER_LAYERS.flatMap((layer) =>
    isWeatherTotal(layer)
      ? [weatherLayerUrl(base, file, layer.key, 0)]
      : file.steps.map((_, step) =>
          weatherLayerUrl(base, file, layer.key, step),
        ),
  );
  return [
    ...urls.filter((url): url is string => url !== null),
    weatherWindUrl(base, file),
  ];
}

/** Whether a saved area's box touches the run's (`bounds`: west, south, east, north), so an area elsewhere keeps no weather. */
export function areaTouchesRun(
  area: { west: number; south: number; east: number; north: number },
  bounds: WeatherMapFile["bounds"],
): boolean {
  const [west, south, east, north] = bounds;
  return (
    area.west <= east &&
    area.east >= west &&
    area.south <= north &&
    area.north >= south
  );
}

/** The arrows file if it has the shape `windArrows` reads, else null. */
export function parseWeatherWind(raw: unknown): WeatherWindFile | null {
  const w = raw as Partial<WeatherWindFile> | null;
  return w &&
    [w.west, w.north, w.step, w.columns, w.rows].every(Number.isFinite) &&
    Array.isArray(w.steps) &&
    w.steps.every((s) => Array.isArray(s?.speed) && Array.isArray(s?.from))
    ? (w as WeatherWindFile)
    : null;
}
