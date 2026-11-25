import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearWeatherTile,
  weatherPointSource,
  type WeatherMapFile,
} from "@logjam/shared";

const tiles = vi.hoisted(() => ({
  asked: [] as string[],
  png: new Uint8Array([1, 2, 3]) as Uint8Array | undefined,
  decoded: null as Float32Array | null,
}));
vi.mock("@logjam/shared", async (orig) => ({
  ...(await orig<typeof import("@logjam/shared")>()),
  // The fake archive: the one tile it holds, whichever file is asked for.
  demArchive: (url: string) => ({
    getZxy: async (z: number, x: number, y: number) => {
      tiles.asked.push(`${url}#${z}/${x}/${y}`);
      return tiles.png ? { data: tiles.png.buffer } : undefined;
    },
  }),
}));
vi.mock("../../geoPdf/terrainJobs", () => ({
  decodeTerrainTile: async () => tiles.decoded,
}));

import { decodeWeatherTile, useWeatherPoint } from "./weatherPoint";

const file = {
  path: "runs/20261107T0000Z-20261107T0600Z/",
  zoom: 5,
  steps: [{ time: "2026-11-07T06:00Z", hours: 1 }],
  totals: [],
  anchor: "2026-11-07T06:00Z",
} as unknown as WeatherMapFile;
const source = weatherPointSource({
  base: "https://app.example",
  file,
  layer: "rain",
  step: 0,
  wind: null,
  now: Date.parse(file.anchor),
})!;
const point = { latitude: -33.7, longitude: 150.3 };

afterEach(() => {
  tiles.asked = [];
  tiles.decoded = null;
  clearWeatherTile();
});

describe("the point panel's weather map value", () => {
  // Mutation: ask for another zoom or file than the one the map draws, or
  // drop the decode, and the figure is not the tile's.
  it("reads the tile of the archive the map draws and decodes it", async () => {
    tiles.decoded = new Float32Array(256 * 256).fill(2.5);
    const { result } = renderHook(() => useWeatherPoint(source, point));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toMatchObject({ layer: "rain", value: 2.5 });
    expect(tiles.asked).toHaveLength(1);
    expect(tiles.asked[0]).toMatch(
      /^https:\/\/app\.example\/master\/weather\/v1\/runs\/.*\/rain\/000\.pmtiles#5\/29\/19$/,
    );
  });

  // Mutation: return the value for a no-value pixel and the panel shows
  // −32768 mm of rain.
  it("has no reading where the pixel holds no value", async () => {
    tiles.decoded = new Float32Array(256 * 256).fill(-32768);
    const { result } = renderHook(() => useWeatherPoint(source, point));
    await waitFor(() => expect(tiles.asked).toHaveLength(1));
    await new Promise((r) => setTimeout(r));
    expect(result.current).toBeNull();
  });

  // Mutation: let a tile that will not decode throw out of the hook, and the
  // press breaks the panel.
  it("has no reading, and no error, for a tile that will not decode", async () => {
    tiles.decoded = null;
    const { result } = renderHook(() => useWeatherPoint(source, point));
    await waitFor(() => expect(tiles.asked).toHaveLength(1));
    await new Promise((r) => setTimeout(r));
    expect(result.current).toBeNull();
    await expect(decodeWeatherTile(new Uint8Array([1]))).rejects.toThrow();
  });

  // Mutation: read while the overlay is off and the panel asks the CDN for a
  // layer nobody is looking at.
  it("reads nothing with the overlay off", async () => {
    const { result } = renderHook(() => useWeatherPoint(null, point));
    await new Promise((r) => setTimeout(r));
    expect(result.current).toBeNull();
    expect(tiles.asked).toEqual([]);
  });
});
