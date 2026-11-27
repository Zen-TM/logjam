// The Weather overlay's value at a point: the pixel of the archive tile the map
// draws there, read the way a DEM height is (terrarium, the four surrounding
// pixels blended, the no-value code read as nothing), plus for wind and gusts
// where it blows from. A client opens the archive and decodes the PNG; the
// tile, the pixel and the arithmetic are here, so the panel and the colour on
// the map cannot disagree about which cell a point is in.
//
// PRIVACY: the point stays on the device. What leaves it is a byte range of
// our own CDN's archive for the one zoom, which names a tile about 1,000 km
// across and nothing finer. Nothing here logs.
// Guard: weatherPoint.test.ts.
import type { PMTiles } from "pmtiles";

import { demSampleHeight, resolveDemSamples } from "./demTiles.js";
import { forgetDemArchive } from "./demSources.js";
import {
  weatherLayer,
  weatherLayerUrl,
  weatherShownLabel,
  type WeatherLayerKey,
  type WeatherMapFile,
  type WeatherWindFile,
} from "./weatherMap.js";

/** What a client hands over to read tiles: a `PMTiles`, or a stand-in. */
export type WeatherArchive = Pick<PMTiles, "getZxy">;

/** A tile's PNG bytes to its 256 × 256 metres, as each client decodes them. */
export type WeatherTileDecoder = (
  png: Uint8Array,
) => Float32Array | Promise<Float32Array>;

/** What the panel needs to read the value the map is drawing. */
export type WeatherPointSource = {
  /** Where the archive the map draws is: an https URL or a file:// URI. */
  archive: string;
  zoom: number;
  layer: WeatherLayerKey;
  /** What the bar says the map shows: a step's time, or a total's window. */
  shown: string;
  /** The arrows' file and the step drawn, for a layer whose direction is shown. */
  wind: { file: WeatherWindFile; step: number } | null;
};

export type WeatherPointReading = {
  layer: WeatherLayerKey;
  value: number;
  /** Degrees the wind blows from; null for anything else, or a calm. */
  from: number | null;
  shown: string;
};

/**
 * The source for what is drawn: `step` is null for a total. Null for an
 * archive the run lacks (a total it left out).
 */
export function weatherPointSource(input: {
  base: string;
  file: WeatherMapFile;
  layer: WeatherLayerKey;
  step: number | null;
  wind: WeatherWindFile | null;
  now: number;
}): WeatherPointSource | null {
  const { base, file, layer, wind, now } = input;
  const step = input.step ?? 0;
  const archive = weatherLayerUrl(base, file, layer, step);
  if (!archive) return null;
  return {
    archive,
    zoom: file.zoom,
    layer,
    shown: weatherShownLabel(file, layer, step, now),
    wind: wind && weatherLayer(layer).arrows ? { file: wind, step } : null,
  };
}

// The last tile read, so a second press on the same step and tile asks the
// network for nothing. One slot: the archive is a new one with every step.
let last: {
  archive: WeatherArchive;
  x: number;
  y: number;
  tile: Promise<Float32Array | null>;
} | null = null;

/** Drops the held tile: after a wipe, and between tests. */
export function clearWeatherTile(): void {
  last = null;
}

/**
 * The layer's value at a position, nearest four pixels blended as a height is
 * (a pixel with no value is left out, and a point with none near it has
 * none), or null. A tile the archive lacks is null too; an archive that will
 * not answer throws, and the caller shows nothing.
 */
export async function weatherValueAt(
  archive: WeatherArchive,
  decode: WeatherTileDecoder,
  zoom: number,
  lon: number,
  lat: number,
): Promise<number | null> {
  const [address] = resolveDemSamples([{ lon, lat, distanceM: 0 }], zoom);
  if (!address) return null;
  const { tileX: x, tileY: y } = address;
  let held = last;
  if (!held || held.archive !== archive || held.x !== x || held.y !== y) {
    const tile = archive
      .getZxy(zoom, x, y)
      .then((got) => (got ? decode(new Uint8Array(got.data)) : null));
    held = { archive, x, y, tile };
    last = held;
    tile.catch(() => {
      // A failed header or directory read is remembered by the library for
      // the object's life: let the next press open a fresh one.
      if (last === held) last = null;
      forgetDemArchive(archive as PMTiles);
    });
  }
  return demSampleHeight(await held.tile, address);
}

/**
 * Where the wind blows from at a position, in degrees: the four grid points
 * round it, their speed-weighted directions as vectors (so 350° and 10° meet
 * at north, not 180°). Null where none has a wind, or where they cancel.
 */
export function weatherWindFrom(
  wind: WeatherWindFile,
  step: number,
  lon: number,
  lat: number,
): number | null {
  const at = wind.steps[step];
  if (!at) return null;
  const column = (lon - wind.west) / wind.step;
  const row = (wind.north - lat) / wind.step;
  const c0 = Math.floor(column);
  const r0 = Math.floor(row);
  const u = column - c0;
  const v = row - r0;
  let east = 0;
  let north = 0;
  for (const [dr, dc, weight] of [
    [0, 0, (1 - u) * (1 - v)],
    [0, 1, u * (1 - v)],
    [1, 0, (1 - u) * v],
    [1, 1, u * v],
  ] as const) {
    const c = c0 + dc;
    const r = r0 + dr;
    if (c < 0 || c >= wind.columns || r < 0 || r >= wind.rows) continue;
    const speed = at.speed[r * wind.columns + c];
    const from = at.from[r * wind.columns + c];
    if (speed == null || from == null) continue;
    east += weight * speed * Math.sin((from * Math.PI) / 180);
    north += weight * speed * Math.cos((from * Math.PI) / 180);
  }
  if (Math.hypot(east, north) < 1e-6) return null;
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

/**
 * The value the map draws at a point, for `source`, or null where it has none.
 * `open` is the client's archive for a URL or file.
 */
export async function weatherPointReading(
  source: WeatherPointSource,
  point: { latitude: number; longitude: number },
  open: (archive: string) => WeatherArchive,
  decode: WeatherTileDecoder,
): Promise<WeatherPointReading | null> {
  const { latitude, longitude } = point;
  const value = await weatherValueAt(
    open(source.archive),
    decode,
    source.zoom,
    longitude,
    latitude,
  );
  if (value === null) return null;
  const from = source.wind
    ? weatherWindFrom(source.wind.file, source.wind.step, longitude, latitude)
    : null;
  return { layer: source.layer, value, from, shown: source.shown };
}

/** What a panel keeps of a read: the point and layer it was read for. */
export type WeatherPointRead = {
  latitude: number;
  longitude: number;
  layer: WeatherLayerKey;
  reading: WeatherPointReading | null;
};

/**
 * The reading to show now: the kept one while it is for this point and this
 * layer, so it holds across the steps Play takes and the clock's ticks (each
 * builds a new `source`) and clears on a new point or layer, or none.
 */
export function weatherPointShown(
  read: WeatherPointRead | null,
  source: WeatherPointSource | null,
  point: { latitude: number; longitude: number },
): WeatherPointReading | null {
  return source &&
    read &&
    read.layer === source.layer &&
    read.latitude === point.latitude &&
    read.longitude === point.longitude
    ? read.reading
    : null;
}

/** A reading's figure as the panel says it: "2.5 mm/h", "−3 °C". */
export function weatherValueText(layer: WeatherLayerKey, value: number) {
  const { unit } = weatherLayer(layer);
  // Rain is small enough to need its tenths until it reaches ten.
  const rain = unit.startsWith("mm");
  const figure =
    rain && Math.abs(value) < 10 ? value.toFixed(1) : value.toFixed(0);
  return `${Number(figure)} ${unit}`.replace("-", "−");
}
