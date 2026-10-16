// A provider tile request is a plain HTTP client: it carries no header of ours.
import { describe, expect, it, vi } from "vitest";
import { DEM_SOURCE_ID } from "@logjam/shared";

const tileFetch = vi.hoisted(() => vi.fn());
vi.mock("expo/fetch", () => ({ fetch: tileFetch }));
vi.mock("expo-file-system/legacy", () => ({}));
vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));
vi.mock("@react-native-community/netinfo", () => ({
  default: { refresh: async () => ({ isConnected: true }) },
}));
vi.mock("./networkPolicy", () => ({ connectionAllowsMetered: () => true }));
vi.mock("./registryDb", () => ({
  insertArtifact: vi.fn(),
  setArtifactSize: vi.fn(),
}));
vi.mock("./regionMbtiles", () => ({
  openRegionMbtiles: async () => ({ db: {}, uri: "" }),
  initRegionMbtiles: vi.fn(),
  readRegionBuildState: async () => null,
  listRegionTileKeys: async () => new Set(),
  writeRegionBatch: vi.fn(),
  closeRegionMbtiles: vi.fn(),
  deleteRegionFile: vi.fn(),
  countRegionTiles: vi.fn(),
  finalizeRegionMbtiles: vi.fn(),
  sampleRegionTilesLookLikeImages: vi.fn(),
}));

const { runRegionDownload } = await import("./regionTileDownload");

describe("runRegionDownload", () => {
  // Mutation: pass any `headers` to the provider fetch (an auth token, an
  // `x-logjam-client`).
  it("asks the provider for a tile with no headers of its own", async () => {
    const token: { stop: null | "pause" | "cancel" } = { stop: null };
    tileFetch.mockImplementation(async () => {
      token.stop = "cancel";
      return { status: 404, headers: new Headers() };
    });

    const outcome = await runRegionDownload(
      {
        id: "r1",
        basemapId: DEM_SOURCE_ID,
        label: "Region",
        groupId: "g1",
        groupLabel: "Area",
        bbox: { west: 150.3, south: -33.71, east: 150.31, north: -33.7 },
        zMin: 12,
        zMax: 12,
        allowCellular: false,
      },
      () => {},
      token,
    );

    expect(outcome.status).toBe("cancelled");
    expect(tileFetch).toHaveBeenCalled();
    for (const [, init] of tileFetch.mock.calls) {
      expect(Object.keys(init)).toEqual(["signal"]);
    }
  });
});
