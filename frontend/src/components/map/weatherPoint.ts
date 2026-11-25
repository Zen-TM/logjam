import { useEffect, useState } from "react";
import {
  demArchive,
  weatherPointReading,
  weatherPointShown,
  type WeatherPointRead,
  type WeatherPointReading,
  type WeatherPointSource,
  type MapPointCoord,
} from "@logjam/shared";
import { decodeTerrainTile } from "../../geoPdf/terrainJobs";

/** The weather archive's tile, decoded as the GeoPDF's terrain tiles are. */
export async function decodeWeatherTile(
  png: Uint8Array,
): Promise<Float32Array> {
  const values = await decodeTerrainTile(
    png.buffer.slice(
      png.byteOffset,
      png.byteOffset + png.byteLength,
    ) as ArrayBuffer,
  );
  if (!values) throw new Error("tile");
  return values;
}

/** Byte ranges of the archive the map draws, from our own origin. */
export const readWeatherPoint = (
  source: WeatherPointSource,
  point: MapPointCoord,
  open: typeof demArchive = demArchive,
  decode: typeof decodeWeatherTile = decodeWeatherTile,
): Promise<WeatherPointReading | null> =>
  weatherPointReading(source, point, (url) => open(url), decode);

/**
 * What the Weather overlay draws at the point, for the layer and step it is
 * drawing now: null with the overlay off, until it is read, where it has no
 * value, and when the archive will not answer. A failure is not shown and not
 * logged: the error could carry the archive's URL, and the row is an extra.
 */
export function useWeatherPoint(
  source: WeatherPointSource | null,
  point: MapPointCoord,
): WeatherPointReading | null {
  const [read, setRead] = useState<WeatherPointRead | null>(null);
  const { latitude, longitude } = point;
  useEffect(() => {
    if (!source) return;
    let live = true;
    readWeatherPoint(source, { latitude, longitude })
      .catch(() => null)
      .then((reading) => {
        if (live)
          setRead({ latitude, longitude, layer: source.layer, reading });
      });
    return () => {
      live = false;
    };
  }, [source, latitude, longitude]);
  return weatherPointShown(read, source, { latitude, longitude });
}
