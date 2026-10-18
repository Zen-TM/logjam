// Mutations that turn it red: write without chaining on `tail` (two cells'
// fetches then drop one); drop the `fetchEpoch !== epoch` check (a fetch begun
// before a wipe re-creates the directory after it).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { weatherCell, type WeatherForecast } from "@logjam/shared";

import {
  cacheForecast,
  readCachedForecast,
  stopWeatherForWipe,
  weatherEpoch,
} from "./weatherStorage";

const files = vi.hoisted(() => ({ text: null as string | null, dirs: 0 }));
vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: async () => {
    // Yield, so unserialised writers would interleave their read and write.
    await Promise.resolve();
    if (files.text === null) throw new Error("missing");
    return files.text;
  },
  writeAsStringAsync: async (_uri: string, text: string) => {
    await Promise.resolve();
    files.text = text;
  },
  makeDirectoryAsync: async () => {
    files.dirs += 1;
  },
}));
vi.mock("../offline/localStores", () => ({ WEATHER_DIR: "file:///w/" }));

const at = (lat: number): WeatherForecast => ({
  cell: weatherCell({ latitude: lat, longitude: 150 }, 600),
  fetchedAt: 1,
  pastRainMm: 0,
  days: [],
});

beforeEach(() => {
  files.text = null;
  files.dirs = 0;
});

describe("the kept forecasts' file", () => {
  it("keeps both cells when two fetches land together", async () => {
    await Promise.all([
      cacheForecast(at(-33), weatherEpoch()),
      cacheForecast(at(-34), weatherEpoch()),
    ]);
    expect(await readCachedForecast(at(-33).cell)).not.toBeNull();
    expect(await readCachedForecast(at(-34).cell)).not.toBeNull();
  });

  it("writes nothing for a fetch begun before a wipe", async () => {
    const begun = weatherEpoch();
    await stopWeatherForWipe();
    await cacheForecast(at(-33), begun);
    expect(files.text).toBeNull();
    expect(files.dirs).toBe(0);
  });
});
