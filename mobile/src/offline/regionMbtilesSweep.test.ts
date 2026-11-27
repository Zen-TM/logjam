import { beforeEach, describe, expect, it, vi } from "vitest";

// An app kill during a first save's clip leaves a `.pmtiles` that the sweep in
// `listUnfinishedRegions` deletes silently; the kept weather run that save
// began would then have no area left to go with.
const h = vi.hoisted(() => ({ swept: 0 }));
vi.mock("expo-file-system/legacy", () => ({
  getInfoAsync: async () => ({ exists: true }),
  readDirectoryAsync: async () => [],
}));
vi.mock("expo-sqlite", () => ({}));
vi.mock("./localStores", () => ({ REGION_DIR: "file:///regions/" }));
vi.mock("./registryDb", () => ({ sweepOrphanFiles: async () => h.swept }));
const reconcile = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./regionDownloads", () => ({
  dropKeptWeatherWithoutAreas: reconcile,
}));

const { listUnfinishedRegions } = await import("./regionMbtiles");

beforeEach(() => reconcile.mockClear());

describe("listUnfinishedRegions' sweep", () => {
  // Mutation: drop the reconcile after the sweep, and the run kept for a first
  // save an OS kill cut short stays, with no area and nothing in Saved to clear it.
  it("reconciles the kept weather run when it deleted a clip", async () => {
    h.swept = 1;
    await listUnfinishedRegions();
    expect(reconcile).toHaveBeenCalledOnce();
  });

  // Mutation: reconcile on every open, and each Saved-tab visit reads the
  // registry for nothing.
  it("leaves the run alone when it deleted nothing", async () => {
    h.swept = 0;
    await listUnfinishedRegions();
    expect(reconcile).not.toHaveBeenCalled();
  });
});
