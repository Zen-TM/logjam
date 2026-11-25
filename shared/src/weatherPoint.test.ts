import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEM_TILE_SIZE, demTileCoordinates } from "./demTiles.js";
import { parseWeatherMap, type WeatherWindFile } from "./weatherMap.js";
import {
  clearWeatherTile,
  weatherPointReading,
  weatherPointSource,
  weatherValueAt,
  weatherValueText,
  weatherWindFrom,
  type WeatherArchive,
} from "./weatherPoint.js";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "__fixtures__", name), "utf8"),
  );
const file = parseWeatherMap(fixture("weather-latest.json"))!;
const wind = fixture("weather-wind.json") as WeatherWindFile;

// A point in the fixture's box (the builder's SMALL_BOX, 149-151 E, 33-35 S).
const LON = 150.3;
const LAT = -33.7;
const BASE = "https://cdn.example";

/** Pixel-centre coordinates of a position inside its z5 tile. */
function pixelOf(lon: number, lat: number) {
  const { x, y } = demTileCoordinates(lon, lat, 5);
  return {
    tile: [Math.floor(x), Math.floor(y)] as const,
    col: (x - Math.floor(x)) * DEM_TILE_SIZE - 0.5,
    row: (y - Math.floor(y)) * DEM_TILE_SIZE - 0.5,
  };
}

/** An archive with the one tile it is asked for, counting the asks. */
function fakeArchive(bytes: number[] = [1, 2, 3]) {
  const asked: [number, number, number][] = [];
  const archive: WeatherArchive = {
    getZxy: async (z, x, y) => {
      asked.push([z, x, y]);
      return { data: new Uint8Array(bytes).buffer };
    },
  };
  return { archive, asked };
}

/** A tile whose value is a plane over its pixels, so a blend is exact. */
const plane = () => {
  const tile = new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE);
  for (let r = 0; r < DEM_TILE_SIZE; r++)
    for (let c = 0; c < DEM_TILE_SIZE; c++)
      tile[r * DEM_TILE_SIZE + c] = c * 0.01 + r * 0.002;
  return tile;
};

beforeEach(clearWeatherTile);

describe("the weather map's value at a point", () => {
  // Mutation: read another zoom, swap x and y, or take the nearest pixel
  // instead of blending, and the tile asked for or the plane's value is off.
  it("reads the one zoom's tile that holds the point, blended between pixels", async () => {
    const { archive, asked } = fakeArchive();
    const at = pixelOf(LON, LAT);
    const value = await weatherValueAt(archive, plane, 5, LON, LAT);
    expect(asked).toEqual([[5, at.tile[0], at.tile[1]]]);
    expect(value).toBeCloseTo(at.col * 0.01 + at.row * 0.002, 4);
  });

  // Mutation: decode a value where the no-value code is and the map's clear
  // pixels read as −32768 mm of rain.
  it("is nothing where the pixel is the no-value code, and re-weights beside it", async () => {
    const { archive } = fakeArchive();
    const at = pixelOf(LON, LAT);
    const row = Math.floor(at.row);
    const col = Math.floor(at.col);
    const tile = new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE).fill(-32768);
    expect(await weatherValueAt(archive, () => tile, 5, LON, LAT)).toBeNull();
    clearWeatherTile();
    tile[row * DEM_TILE_SIZE + col] = 7;
    expect(await weatherValueAt(archive, () => tile, 5, LON, LAT)).toBe(7);
  });

  // Mutation: return 0 for a tile the archive lacks and a point off the box
  // reads as a dry one.
  it("is nothing where the archive has no tile", async () => {
    const archive: WeatherArchive = { getZxy: async () => undefined };
    expect(await weatherValueAt(archive, plane, 5, LON, LAT)).toBeNull();
  });

  // Mutation: drop the held tile and a second press asks the network again;
  // keep it across archives and a new step reads the last step's tile.
  it("holds the last tile for the same archive only", async () => {
    const a = fakeArchive();
    const b = fakeArchive();
    const decode = vi.fn(plane);
    await weatherValueAt(a.archive, decode, 5, LON, LAT);
    await weatherValueAt(a.archive, decode, 5, LON + 0.01, LAT);
    expect(a.asked).toHaveLength(1);
    expect(decode).toHaveBeenCalledTimes(1);
    await weatherValueAt(b.archive, decode, 5, LON, LAT);
    expect(b.asked).toHaveLength(1);
  });

  // Mutation: keep a failed read and every later press fails the same way.
  it("throws for an archive that will not answer, and asks again next time", async () => {
    let fail = true;
    const archive: WeatherArchive = {
      getZxy: async () => {
        if (fail) throw new Error("range");
        return { data: new Uint8Array([1]).buffer };
      },
    };
    await expect(weatherValueAt(archive, plane, 5, LON, LAT)).rejects.toThrow();
    fail = false;
    expect(await weatherValueAt(archive, plane, 5, LON, LAT)).not.toBeNull();
  });
});

describe("which way the wind blows at a point", () => {
  const grid = (
    speed: (number | null)[],
    from: (number | null)[],
  ): WeatherWindFile => ({
    west: 150,
    north: -33,
    step: 0.5,
    columns: 2,
    rows: 2,
    steps: [{ speed, from }],
  });

  // Mutation: average the degrees and 350° with 10° comes out south.
  it("blends directions as vectors, so north-west and north-east meet at north", () => {
    const w = grid([10, 10, 10, 10], [350, 10, 350, 10]);
    expect(weatherWindFrom(w, 0, 150.25, -33.25)).toBeCloseTo(0, 4);
    expect(weatherWindFrom(w, 0, 150, -33)).toBeCloseTo(350, 4);
  });

  // Mutation: weigh the points equally and a calm point pulls a gale's
  // direction.
  it("weighs a point by its speed and skips one with no wind", () => {
    const w = grid([30, 0, null, null], [90, 270, null, null]);
    expect(weatherWindFrom(w, 0, 150.25, -33)).toBeCloseTo(90, 4);
    expect(
      weatherWindFrom(
        grid([null, null, null, null], [1, 2, 3, 4]),
        0,
        150.1,
        -33.1,
      ),
    ).toBeNull();
    // Opposite and equal: nothing to say.
    expect(
      weatherWindFrom(
        grid([10, 10, 10, 10], [90, 270, 90, 270]),
        0,
        150.25,
        -33.25,
      ),
    ).toBeNull();
  });

  it("is nothing for a step the file lacks or a point off the grid", () => {
    expect(weatherWindFrom(wind, 99, 150, -34)).toBeNull();
    expect(weatherWindFrom(wind, 0, 10, 10)).toBeNull();
  });

  it("reads the builder's own file", () => {
    const from = weatherWindFrom(wind, 0, wind.west + 0.25, wind.north - 0.25);
    expect(from).not.toBeNull();
    expect(from).toBeGreaterThanOrEqual(0);
    expect(from).toBeLessThan(360);
  });
});

describe("what a point reads for the layer on the map", () => {
  // Mutation: build the wrong archive for a total, or give a field layer the
  // wind and rain shows a direction.
  it("names the archive the map draws and keeps the wind for wind layers", () => {
    const common = { base: BASE, file, wind, now: Date.parse(file.anchor) };
    const rain = weatherPointSource({ ...common, layer: "rain", step: 2 })!;
    expect(rain.archive).toBe(
      `${BASE}/master/weather/v1/${file.path}rain/002.pmtiles`,
    );
    expect(rain.zoom).toBe(file.zoom);
    expect(rain.wind).toBeNull();
    const gusts = weatherPointSource({ ...common, layer: "gusts", step: 1 })!;
    expect(gusts.wind).toEqual({ file: wind, step: 1 });
    const total = weatherPointSource({
      ...common,
      layer: "rainPast72",
      step: null,
    })!;
    expect(total.archive).toBe(
      `${BASE}/master/weather/v1/${file.path}totals/rainPast72.pmtiles`,
    );
    expect(
      weatherPointSource({
        ...common,
        file: { ...file, totals: [] },
        layer: "rainPast72",
        step: null,
      }),
    ).toBeNull();
  });

  it("reads the value, and the direction for wind", async () => {
    const { archive } = fakeArchive();
    const open = vi.fn(() => archive);
    const source = weatherPointSource({
      base: BASE,
      file,
      layer: "wind",
      step: 0,
      wind,
      now: Date.parse(file.anchor),
    })!;
    const reading = await weatherPointReading(
      source,
      { latitude: wind.north - 0.25, longitude: wind.west + 0.25 },
      open,
      () => plane().fill(24),
    );
    expect(open).toHaveBeenCalledWith(source.archive);
    expect(reading).toMatchObject({ layer: "wind", value: 24 });
    expect(reading!.from).not.toBeNull();
    expect(
      await weatherPointReading(
        source,
        { latitude: 10, longitude: 10 },
        () => ({ getZxy: async () => undefined }),
        plane,
      ),
    ).toBeNull();
  });
});

describe("a reading's figure", () => {
  // Mutation: print every value to one decimal and a 38 mm total reads 38.0.
  it("keeps tenths for small rain only, and a real minus sign", () => {
    expect(weatherValueText("rain", 2.46)).toBe("2.5 mm/h");
    expect(weatherValueText("rain", 0)).toBe("0 mm/h");
    expect(weatherValueText("rainPast168", 37.6)).toBe("38 mm");
    expect(weatherValueText("rainPast24", 0.34)).toBe("0.3 mm");
    expect(weatherValueText("wind", 23.6)).toBe("24 km/h");
    expect(weatherValueText("temperature", -2.6)).toBe("−3 °C");
  });
});
