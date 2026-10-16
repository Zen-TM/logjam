// mobile/AGENTS.md, Privacy: a region-of-interest bbox reaches the server only
// as the body of the clip request. The download that follows names an opaque
// token, never the area.
import { describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
const createDownloadResumable = vi.hoisted(() => vi.fn());
vi.mock("../api/apiFetch", () => ({
  apiFetch,
  getAuthedRequestHeaders: async () => ({ Authorization: "Bearer t" }),
}));
vi.mock("../config", () => ({ config: { apiUrl: "https://api.test" } }));
vi.mock("./registryDb", () => ({
  insertArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
}));
vi.mock("./freeSpace", () => ({ assertSpaceFor: vi.fn() }));
vi.mock("./localStores", () => ({ REGION_DIR: "file:///regions/" }));
vi.mock("expo-file-system/legacy", () => ({
  makeDirectoryAsync: vi.fn(),
  createDownloadResumable,
  getInfoAsync: async () => ({ exists: true, size: 7 }),
  readAsStringAsync: async () => btoa("PMTiles"),
  deleteAsync: vi.fn(),
  EncodingType: { Base64: "base64" },
}));

const { downloadProtomapsRegion } = await import("./regionDownloads");

describe("downloadProtomapsRegion", () => {
  // Mutation: put the bbox in the clip request's URL, or in the download's.
  it("sends the bbox only in the clip request's body", async () => {
    const bbox = { west: 150.3, south: -33.71, east: 150.31, north: -33.7 };
    apiFetch.mockResolvedValueOnce({
      token: "opaque",
      sizeBytes: 7,
      expiresInSeconds: 60,
    });
    createDownloadResumable.mockReturnValueOnce({
      downloadAsync: async () => ({ status: 200 }),
    });

    await downloadProtomapsRegion({
      id: "r1",
      label: "Region",
      groupId: "g1",
      groupLabel: "Area",
      bbox,
    });

    expect(apiFetch).toHaveBeenCalledExactlyOnceWith("/basemap/region-clip", {
      method: "POST",
      body: bbox,
    });
    expect(createDownloadResumable.mock.calls[0][0]).toBe(
      "https://api.test/basemap/region-clip/opaque",
    );
  });
});
