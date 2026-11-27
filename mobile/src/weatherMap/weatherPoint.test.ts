import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  clearWeatherTile,
  demSampleHeight,
  resolveDemSamples,
  weatherPointSource,
  type WeatherMapFile,
} from "@logjam/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeDemPng } from "../offline/demPng";
import { canReadWeatherPoint, readWeatherPoint } from "./weatherPoint";

// A real terrarium tile stands in for the archive's (the weather tiles are
// the same encoding, RGB, 256 square: topo/build_weather.py).
const PNG = new Uint8Array(
  readFileSync(
    join(
      __dirname,
      "../../../shared/src/__fixtures__/terrarium-z13-7516-4911.png",
    ),
  ),
);
const held = vi.hoisted(() => ({
  asked: [] as string[],
  files: [] as string[],
  tile: undefined as boolean | undefined,
}));
vi.mock("@logjam/shared", async (orig) => ({
  ...(await orig<typeof import("@logjam/shared")>()),
  demArchive: (archive: string | { getKey: () => string }) => {
    const key = typeof archive === "string" ? archive : archive.getKey();
    return {
      getZxy: async (z: number, x: number, y: number) => {
        held.asked.push(`${key}#${z}/${x}/${y}`);
        return held.tile === false ? undefined : { data: PNG.slice().buffer };
      },
    };
  },
}));
vi.mock("../map/snapLines", () => ({
  fileSource: (path: string) => ({ getKey: () => `file://${path}` }),
}));

const file = {
  path: "runs/20261107T0000Z-20261107T0600Z/",
  zoom: 5,
  steps: [{ time: "2026-11-07T06:00Z", hours: 1 }],
  totals: [],
  anchor: "2026-11-07T06:00Z",
} as unknown as WeatherMapFile;
const sourceAt = (base: string) =>
  weatherPointSource({
    base,
    file,
    layer: "rain",
    step: 0,
    wind: null,
    now: Date.parse(file.anchor),
  })!;
const point = { latitude: -33.7, longitude: 150.3 };

afterEach(() => {
  held.asked = [];
  held.tile = undefined;
  clearWeatherTile();
});

describe("the point sheet's weather map value", () => {
  // Mutation: read the tile with another decoder or pixel rule than the DEM's,
  // or ask for another zoom, and the figure or the tile asked for is off.
  it("reads the CDN's archive and decodes the tile as a height is", async () => {
    const reading = await readWeatherPoint(
      sourceAt("https://cdn.example"),
      point,
    );
    const [address] = resolveDemSamples(
      [{ lon: point.longitude, lat: point.latitude, distanceM: 0 }],
      5,
    );
    expect(held.asked).toEqual([
      expect.stringMatching(
        /^https:\/\/cdn\.example\/.*rain\/000\.pmtiles#5\/29\/19$/,
      ),
    ]);
    expect(reading).toMatchObject({ layer: "rain" });
    expect(reading!.value).toBeCloseTo(
      demSampleHeight(decodeDemPng(PNG), address!)!,
      6,
    );
  });

  // Mutation: send a kept copy's file:// URI to the network reader, and the
  // sheet reads nothing offline where the map still draws.
  it("reads the copy kept on the phone as a file", async () => {
    await readWeatherPoint(sourceAt("file:///data/weather"), point);
    expect(held.asked[0]).toMatch(
      /^file:\/\/\/data\/weather\/master\/weather\/v1\/.*rain\/000\.pmtiles#5\//,
    );
  });

  it("has no reading where the archive has no tile", async () => {
    held.tile = false;
    expect(
      await readWeatherPoint(sourceAt("https://cdn.example"), point),
    ).toBeNull();
  });

  // Mutation: let "Simulating offline mode" read a CDN archive, and the sheet
  // sends a request while the map is meant to be silent.
  it("reads a CDN archive only with the network allowed", () => {
    const cdn = sourceAt("https://cdn.example");
    const kept = sourceAt("file:///data/weather");
    expect(canReadWeatherPoint(cdn, true)).toBe(true);
    expect(canReadWeatherPoint(cdn, false)).toBe(false);
    expect(canReadWeatherPoint(kept, false)).toBe(true);
  });

  // Mutation: stop passing the weather figure to the facts, or the source to
  // the sheet, and a pressed point has no weather map row.
  it("is wired from the map screen into the facts", () => {
    const read = (f: string) =>
      readFileSync(join(__dirname, "../map", f), "utf8");
    expect(read("MapScreen.tsx")).toContain("weatherPoint={weatherPoint}");
    expect(read("MapPointSheet.tsx")).toMatch(/weatherMap,\n/);
  });
});
