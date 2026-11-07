// Mutations that turn it red: write the manifest before the files (a stopped
// download leaves a manifest over missing files); keep a file whose status is
// not 200; drop the epoch check (a download begun before a wipe writes after
// it); drop `dropRunsExcept` (the run before is never replaced); skip the
// `canRunNow` check (a download starts on mobile data the user ruled out).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { weatherFixture } from "./weatherMapFixture";
import { weatherRunUrls } from "./weatherMapRun";

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
  order: [] as string[],
  status: 200,
  failAt: -1,
  canRun: true,
  latest: null as null | { file: unknown; text: string },
  canRunArgs: [] as unknown[][],
}));
vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: async (uri: string) => {
    const text = h.files.get(uri);
    if (text === undefined) throw new Error("missing");
    return text;
  },
  writeAsStringAsync: async (uri: string, text: string) => {
    h.order.push("manifest");
    h.files.set(uri, text);
  },
  makeDirectoryAsync: async () => {},
  readDirectoryAsync: async (dir: string) => [
    ...new Set(
      [...h.files.keys()]
        .filter((k) => k.startsWith(dir))
        .map((k) => k.slice(dir.length).split("/")[0]!),
    ),
  ],
  deleteAsync: async (uri: string) => {
    for (const k of [...h.files.keys()])
      if (k.startsWith(uri)) h.files.delete(k);
  },
}));
vi.mock("../api/presignedTransfer", () => ({
  downloadFromPresignedUrl: async (_from: string, to: string) => {
    if (h.order.filter((o) => o === "file").length === h.failAt)
      throw new Error("connection lost");
    h.order.push("file");
    h.files.set(to, "body");
    return { status: h.status };
  },
}));
vi.mock("../offline/localStores", () => ({ WEATHER_MAP_DIR: "file:///w/" }));
vi.mock("../config", () => ({
  config: { topoCdnBaseUrl: "https://cdn.example" },
}));
vi.mock("../offline/networkPolicy", () => ({
  canRunNow: async (...args: unknown[]) => {
    h.canRunArgs.push(args);
    return h.canRun;
  },
}));
vi.mock("./weatherMapFeed", () => ({
  fetchWeatherManifest: async () => h.latest,
}));

const { keepLatestWeather } = await import("./weatherMapKeep");
const { readKeptWeather, stopWeatherMapForWipe } = await import(
  "./weatherMapStorage"
);

const PERTH = { west: 115.8, south: -32, east: 116, north: -31.9 };
const BLUE_MOUNTAINS = { west: 150.2, south: -33.7, east: 150.3, north: -33.6 };
const newRun = { ...weatherFixture, path: "runs/20261107T0600Z/" };
const keptFiles = (run: { path: string }) =>
  [...h.files.keys()].filter((k) => k.includes(run.path));

beforeEach(() => {
  h.files.clear();
  h.order = [];
  h.status = 200;
  h.failAt = -1;
  h.canRun = true;
  h.canRunArgs = [];
  h.latest = { file: weatherFixture, text: JSON.stringify(weatherFixture) };
});

describe("keepLatestWeather", () => {
  it("keeps every file of the run, then the manifest", async () => {
    await keepLatestWeather(false, BLUE_MOUNTAINS);
    const urls = weatherRunUrls("file:///w", weatherFixture);
    expect(urls.every((u) => h.files.has(u))).toBe(true);
    expect(h.order.at(-1)).toBe("manifest");
    expect(h.order.filter((o) => o === "manifest")).toHaveLength(1);
    expect(await readKeptWeather()).toEqual(weatherFixture);
  });

  it("asks the connection rule with the download's own answer on mobile data", async () => {
    await keepLatestWeather(true, BLUE_MOUNTAINS);
    expect(h.canRunArgs[0]).toEqual(["topoDownload", true]);
    h.canRun = false;
    h.files.clear();
    await keepLatestWeather(false, BLUE_MOUNTAINS);
    expect(h.canRunArgs[1]).toEqual(["topoDownload", false]);
    expect(h.files.size).toBe(0);
  });

  // Mutation: compare `built`, or nothing, and a second area saved the same
  // hour downloads the same 12 MB again.
  it("does nothing when the run is already kept", async () => {
    await keepLatestWeather(false, BLUE_MOUNTAINS);
    const before = h.order.length;
    await keepLatestWeather(false, BLUE_MOUNTAINS);
    expect(h.order).toHaveLength(before);
  });

  it("replaces the run before it, so one run is kept", async () => {
    await keepLatestWeather(false, BLUE_MOUNTAINS);
    h.latest = { file: newRun, text: JSON.stringify(newRun) };
    await keepLatestWeather(false, BLUE_MOUNTAINS);
    expect(keptFiles(weatherFixture)).toEqual([]);
    expect(keptFiles(newRun).length).toBeGreaterThan(0);
    expect((await readKeptWeather())?.path).toBe(newRun.path);
  });

  // Mutation: write the manifest whatever the downloads did, and the overlay
  // draws a run with files missing.
  it("keeps the run before, whole, when the connection drops midway", async () => {
    await keepLatestWeather(false, BLUE_MOUNTAINS);
    h.latest = { file: newRun, text: JSON.stringify(newRun) };
    h.failAt = h.order.filter((o) => o === "file").length + 10;
    await keepLatestWeather(false, BLUE_MOUNTAINS);
    expect((await readKeptWeather())?.path).toBe(weatherFixture.path);
    expect(keptFiles(newRun)).toEqual([]);
    expect(keptFiles(weatherFixture).length).toBeGreaterThan(0);
  });

  // Mutation: drop the status check, and an error page is kept as a tile.
  it("gives up on a file that is not a 200", async () => {
    h.status = 404;
    await keepLatestWeather(false, BLUE_MOUNTAINS);
    expect(await readKeptWeather()).toBeNull();
    expect(h.order).not.toContain("manifest");
  });

  it("keeps nothing for an area the run does not cover", async () => {
    await keepLatestWeather(false, PERTH);
    expect(h.files.size).toBe(0);
  });

  it("keeps nothing without a manifest", async () => {
    h.latest = null;
    await keepLatestWeather(false, BLUE_MOUNTAINS);
    expect(h.files.size).toBe(0);
  });

  // Mutation: drop the epoch check, and a download in flight when the user
  // signs out writes its manifest into the wiped store.
  it("writes nothing after a wipe", async () => {
    const done = keepLatestWeather(false, BLUE_MOUNTAINS);
    await stopWeatherMapForWipe();
    await done;
    expect(h.order).not.toContain("manifest");
  });
});
