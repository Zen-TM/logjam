// Exercises the real terrarium decode path — only `fetch` is faked. The tiles
// are genuine PNGs built with the same canvas library the decoder uses, so a
// change that breaks the byte layout (channel order, premultiplied alpha, the
// -32768 offset) fails here rather than silently reading mountains as valleys.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCanvas } from "canvas";
import {
  DEM_TILE_ZOOM,
  clearDemTileCache,
  sampleElevations,
} from "./elevation";
import type { SamplePosition } from "@logjam/shared";

const TILE_SIZE = 256;

/** Build a real terrarium PNG whose height at each pixel comes from `heightAt`. */
function terrariumTile(heightAt: (x: number, y: number) => number): Buffer {
  const canvas = createCanvas(TILE_SIZE, TILE_SIZE);
  const context = canvas.getContext("2d");
  const image = context.createImageData(TILE_SIZE, TILE_SIZE);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const value = heightAt(x, y) + 32768;
      const offset = (y * TILE_SIZE + x) * 4;
      image.data[offset] = Math.floor(value / 256);
      image.data[offset + 1] = Math.floor(value) % 256;
      image.data[offset + 2] = Math.round((value - Math.floor(value)) * 256);
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toBuffer("image/png");
}

function pngResponse(buffer: Buffer): Response {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: { "Content-Type": "image/png" },
  });
}

/** Two positions ~2 km apart in the Blue Mountains — same DEM tile at z13. */
const NEARBY: SamplePosition[] = [
  { lon: 150.3119, lat: -33.7128, distanceM: 0 },
  { lon: 150.3319, lat: -33.7228, distanceM: 2000 },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearDemTileCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sampleElevations", () => {
  it("returns nothing for no positions, without touching the network", async () => {
    expect(await sampleElevations([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("decodes terrarium heights back to the metres they encode", async () => {
    fetchMock.mockResolvedValue(pngResponse(terrariumTile(() => 1017.5)));
    const [first, second] = await sampleElevations(NEARBY);
    expect(first).toBeCloseTo(1017.5, 2);
    expect(second).toBeCloseTo(1017.5, 2);
  });

  it("round-trips negative heights (below sea level)", async () => {
    fetchMock.mockResolvedValue(pngResponse(terrariumTile(() => -12)));
    const [value] = await sampleElevations(NEARBY.slice(0, 1));
    expect(value).toBeCloseTo(-12, 2);
  });

  it("reads distinct pixels, not one value for the whole tile", async () => {
    // Height varies across the tile, so two positions landing on different
    // pixels must differ — this is what catches an index/stride mistake.
    fetchMock.mockResolvedValue(pngResponse(terrariumTile((x, y) => x + y)));
    const [first, second] = await sampleElevations(NEARBY);
    expect(first).not.toBe(second);
  });

  it("fetches each tile once however many samples land in it", async () => {
    fetchMock.mockResolvedValue(pngResponse(terrariumTile(() => 500)));
    const many: SamplePosition[] = Array.from({ length: 40 }, (_, i) => ({
      lon: 150.31 + i * 0.0001,
      lat: -33.71,
      distanceM: i * 10,
    }));
    const values = await sampleElevations(many);
    expect(values).toHaveLength(40);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves a second call from the tile cache", async () => {
    fetchMock.mockResolvedValue(pngResponse(terrariumTile(() => 500)));
    await sampleElevations(NEARBY);
    await sampleElevations(NEARBY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requests the DEM at the documented zoom", async () => {
    fetchMock.mockResolvedValue(pngResponse(terrariumTile(() => 500)));
    await sampleElevations(NEARBY.slice(0, 1));
    expect(fetchMock.mock.calls[0]![0]).toContain(`/${DEM_TILE_ZOOM}/`);
  });

  it("reports null where the DEM has no tile", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    expect(await sampleElevations(NEARBY)).toEqual([null, null]);
  });

  it("reports null for the terrarium no-data sentinel", async () => {
    fetchMock.mockResolvedValue(pngResponse(terrariumTile(() => -32768)));
    expect(await sampleElevations(NEARBY.slice(0, 1))).toEqual([null]);
  });

  it("throws on an upstream failure rather than reading it as flat ground", async () => {
    // The dangerous silent failure: a 500 that becomes null becomes a flat
    // profile over real mountains.
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    await expect(sampleElevations(NEARBY)).rejects.toThrow(/status 500/);
  });

  it("never puts a tile URL in the thrown message", async () => {
    // A tile index is a coarse location; error text must not carry it.
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(sampleElevations(NEARBY)).rejects.toThrow(
      /^DEM tile request failed with status 503$/,
    );
  });
});
