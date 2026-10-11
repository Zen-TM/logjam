// Guard: the sign-out wipe resets MapLibre's ambient tile cache, and a failure
// there is reported rather than swallowed. Dropping the `resetDatabase` call
// turns the first test red; dropping the `failed.push("map tile cache")` turns
// the second red.
import { beforeEach, describe, expect, it, vi } from "vitest";

const resetDatabase = vi.fn();

vi.mock("@maplibre/maplibre-react-native", () => ({
  OfflineManager: { resetDatabase: () => resetDatabase() },
}));
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: vi.fn(async () => {}),
  readDirectoryAsync: vi.fn(async () => []),
}));
vi.mock("./localStores", () => ({
  CACHE_ROOT: "file:///cache/",
  WIPED_DIRS: [],
}));
vi.mock("../api/apiFetch", () => ({ invalidateCurrentUser: vi.fn() }));
vi.mock("../geopdf/importRunner", () => ({
  stopGeoPdfImportRun: vi.fn(async () => {}),
}));
vi.mock("../sync/syncDb", () => ({ wipeAllSyncData: vi.fn(async () => {}) }));
vi.mock("../tracks/trackRecorder", () => ({
  stopTrackRecordingForWipe: vi.fn(async () => {}),
}));
vi.mock("./demLookup", () => ({ clearOfflineDemCache: vi.fn() }));
vi.mock("./regionDownloadQueue", () => ({
  cancelAllRegionDownloads: vi.fn(async () => {}),
}));
vi.mock("./registryDb", () => ({
  getOfflineDb: async () => ({
    withTransactionAsync: async (fn: () => Promise<void>) => fn(),
    runAsync: vi.fn(async () => {}),
  }),
  notifyRegistryChanged: vi.fn(),
}));

const { wipeAllLocalData } = await import("./wipeLocalData");

beforeEach(() => {
  resetDatabase.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("wipeAllLocalData and the MapLibre tile cache", () => {
  it("resets the ambient cache and reports a clean wipe", async () => {
    expect(await wipeAllLocalData()).toEqual({ failed: [] });
    expect(resetDatabase).toHaveBeenCalledOnce();
  });

  it("names the tile cache as failed, and still clears the rest", async () => {
    resetDatabase.mockRejectedValue(new Error("boom"));
    expect(await wipeAllLocalData()).toEqual({ failed: ["map tile cache"] });
  });
});
