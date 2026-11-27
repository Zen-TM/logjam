// The Weather overlay's value at a point the user pressed, for the panel
// (shared `weatherPointReading`): a byte range of the archive the map is
// drawing, from the CDN or the copy kept on the phone, so it reads offline
// where the map draws. Sends nothing but that range to our own CDN, and
// logs nothing: the point and the value stay in the panel.
import {
  demArchive,
  weatherPointReading,
  type MapPointCoord,
  type WeatherPointReading,
  type WeatherPointSource,
} from "@logjam/shared";

import { fileSource } from "../map/snapLines";
import { decodeDemPng } from "../offline/demPng";

/** The kept copy's files are `file://` URIs; the CDN's are https URLs. */
const isKept = (archive: string): boolean => archive.startsWith("file:");

/**
 * Whether the panel may read this source: "Simulating offline mode" reads
 * only what is on the phone, as the elevation does.
 */
export function canReadWeatherPoint(
  source: WeatherPointSource,
  allowNetwork: boolean,
): boolean {
  return allowNetwork || isKept(source.archive);
}

/** The archive of a URL or a kept file, held per key by the shared cache. */
export function openWeatherArchive(archive: string) {
  return demArchive(
    isKept(archive) ? fileSource(archive.replace(/^file:\/\//, "")) : archive,
  );
}

export const readWeatherPoint = (
  source: WeatherPointSource,
  point: MapPointCoord,
): Promise<WeatherPointReading | null> =>
  weatherPointReading(source, point, openWeatherArchive, decodeDemPng);
