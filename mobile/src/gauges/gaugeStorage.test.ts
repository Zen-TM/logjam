// Mutations that turn it red: drop the `fetchEpoch !== epoch` check (a fetch
// begun before a wipe re-creates the directory after it).
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cacheGaugeHistory,
  cacheGauges,
  readCachedGaugeHistory,
  gaugesEpoch,
  readCachedGauges,
  stopGaugesForWipe,
} from "./gaugeStorage";
import { gaugeFixture } from "./gaugeFixture";

const fs = vi.hoisted(() => ({ files: new Map<string, string>(), dirs: 0 }));
vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: async (uri: string) => {
    const text = fs.files.get(uri);
    if (text === undefined) throw new Error("missing");
    return text;
  },
  writeAsStringAsync: async (uri: string, text: string) => {
    fs.files.set(uri, text);
  },
  getInfoAsync: async (uri: string) =>
    fs.files.has(uri)
      ? { exists: true, modificationTime: Date.now() / 1000 - 120 }
      : { exists: false },
  makeDirectoryAsync: async () => {
    fs.dirs += 1;
  },
}));
vi.mock("../offline/localStores", () => ({ GAUGES_DIR: "file:///g/" }));

beforeEach(() => {
  fs.files.clear();
  fs.dirs = 0;
});

describe("the kept gauge file", () => {
  it("reads back what was cached", async () => {
    await cacheGauges(JSON.stringify(gaugeFixture), gaugesEpoch());
    expect(await readCachedGauges()).toEqual(gaugeFixture);
  });

  it("reads null for a file that is not a gauge file", async () => {
    fs.files.set("file:///g/latest.json", '{"version":9}');
    expect(await readCachedGauges()).toBeNull();
  });

  it("writes nothing for a fetch begun before a wipe", async () => {
    const begun = gaugesEpoch();
    await stopGaugesForWipe();
    await cacheGauges(JSON.stringify(gaugeFixture), begun);
    expect(fs.files.size).toBe(0);
    expect(fs.dirs).toBe(0);
  });
});

// Mutations that turn it red: drop the epoch check from `keep` (a history
// fetched before a wipe lands after it); build the path from an unchecked id.
describe("the kept gauge histories", () => {
  const text = JSON.stringify({
    version: 1,
    id: "900001",
    start: "2026-10-01",
    level: [0.9],
    flow: [1],
  });

  it("reads back what was kept, with its age", async () => {
    await cacheGaugeHistory("900001", text, gaugesEpoch());
    const kept = await readCachedGaugeHistory("900001");
    expect(kept?.file.level).toEqual([0.9]);
    expect(kept?.ageMs).toBeGreaterThan(100_000);
    expect(fs.files.has("file:///g/history/900001.json")).toBe(true);
  });

  it("reads nothing for a missing file, a bad one or an id that is not a station", async () => {
    expect(await readCachedGaugeHistory("900009")).toBeNull();
    fs.files.set("file:///g/history/900002.json", '{"version":9}');
    expect(await readCachedGaugeHistory("900002")).toBeNull();
    await cacheGaugeHistory("../latest", text, gaugesEpoch());
    expect(fs.files.size).toBe(1);
  });

  it("writes nothing for a fetch begun before a wipe", async () => {
    const begun = gaugesEpoch();
    await stopGaugesForWipe();
    await cacheGaugeHistory("900001", text, begun);
    expect(fs.files.size).toBe(0);
  });
});
