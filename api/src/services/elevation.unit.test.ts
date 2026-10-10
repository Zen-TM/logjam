// Exercises the real terrarium decode path — only `fetch` is faked. The tiles
// are genuine PNGs built with the same canvas library the decoder uses, so a
// change that breaks the byte layout (channel order, premultiplied alpha, the
// -32768 offset) fails here rather than silently reading mountains as valleys.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCanvas } from "canvas";
import {
  clearDemTileCache,
  sampleElevations as sampleDemElevations,
} from "./elevation";
import { NSW_5M, TERRARIUM, type SamplePosition } from "@logjam/shared";

// The archive source is read from the CDN base, which the unit env leaves
// unset: these tests then see the worldwide source alone, as before. The
// parity case for the archive sets it.
const envOverride = vi.hoisted(() => ({}) as { TOPO_CDN_BASE_URL?: string });
vi.mock("../lib/env", async (original) => {
  const real = await original<typeof import("../lib/env")>();
  return { ...real, getEnv: () => ({ ...real.getEnv(), ...envOverride }) };
});

const sampleElevations = async (positions: readonly SamplePosition[]) =>
  (await sampleDemElevations(positions)).heights;

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
  delete envOverride.TOPO_CDN_BASE_URL;
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
    expect(fetchMock.mock.calls[0]![0]).toContain(`/${TERRARIUM.sampleZoom}/`);
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

  // Half of the DEM parity pair; the other half is
  // mobile/src/offline/demLookup.test.ts. Both readers are handed the same
  // real tile and must give the heights and source ids in the fixture, which
  // were worked out by a third, independent decoder.
  //
  // Mutation: sample in this reader instead of through `sampleDem` and the
  // heights drift from Logjam GPS's by metres.
  it("reads the heights and source ids Logjam GPS reads from the same tile (parity)", async () => {
    const fixtures = join(__dirname, "../../../shared/src/__fixtures__");
    const parity = JSON.parse(
      readFileSync(join(fixtures, "dem-parity.json"), "utf8"),
    ) as {
      positions: SamplePosition[];
      heights: number[];
      sourceIds: string[];
    };
    fetchMock.mockResolvedValue(
      pngResponse(readFileSync(join(fixtures, "terrarium-z13-7516-4911.png"))),
    );
    const dem = await sampleDemElevations(parity.positions);
    expect(dem.sourceIds).toEqual(parity.sourceIds);
    dem.heights.forEach((height, i) =>
      expect(height).toBeCloseTo(parity.heights[i]!, 2),
    );
  });

  // The same pair again for a source read from an archive, on a line that
  // leaves the archive: three positions in the fixture archive (three real
  // z15 tiles of the NSW 5 m DEM), then two it lacks, which fall through to
  // the worldwide tile. The join between them is a seam, so `levelled` is in
  // the fixture too.
  //
  // Mutation: read the archive at any zoom but the source's `sampleZoom`, or
  // skip the fall-through, and the source ids stop matching.
  it("reads an archive source and falls through where it ends (parity)", async () => {
    const fixtures = join(__dirname, "../../../shared/src/__fixtures__");
    const parity = JSON.parse(
      readFileSync(join(fixtures, "dem-parity-nsw.json"), "utf8"),
    ) as {
      positions: SamplePosition[];
      heights: number[];
      levelled: number[];
      sourceIds: string[];
    };
    const archive = readFileSync(join(fixtures, "nsw-5m-z15-katoomba.pmtiles"));
    const worldwide = readFileSync(
      join(fixtures, "terrarium-z13-7516-4911.png"),
    );
    envOverride.TOPO_CDN_BASE_URL = "https://cdn.test";
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url !== `https://cdn.test/${NSW_5M.archivePath}`)
        return pngResponse(worldwide);
      const range = new Headers(init?.headers).get("range")!;
      const [from, to] = range.replace("bytes=", "").split("-").map(Number);
      return new Response(new Uint8Array(archive.subarray(from, to! + 1)), {
        status: 206,
      });
    });

    const dem = await sampleDemElevations(parity.positions);
    expect(dem.sourceIds).toEqual(parity.sourceIds);
    dem.heights.forEach((height, i) =>
      expect(height).toBeCloseTo(parity.heights[i]!, 1),
    );
    dem.levelled.forEach((height, i) =>
      expect(height).toBeCloseTo(parity.levelled[i]!, 1),
    );
  });

  it("treats an archive that will not open as a source with nothing", async () => {
    envOverride.TOPO_CDN_BASE_URL = "https://cdn.test";
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith("https://cdn.test")
        ? new Response("", { status: 404 })
        : pngResponse(terrariumTile(() => 700)),
    );
    const dem = await sampleDemElevations(NEARBY);
    expect(dem.sourceIds).toEqual(["terrarium", "terrarium"]);
    // Asked once, then remembered: not once per profile.
    await sampleDemElevations(NEARBY);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("cdn.test")),
    ).toHaveLength(1);
  });
});
