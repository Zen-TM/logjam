// Mutations that turn it red: drop the `fetchEpoch !== epoch` check (a fetch
// begun before a wipe re-creates the directory after it).
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cacheGauges,
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
