import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("../prefsDb", () => ({
  readPref: (key: string) => store.get(key) ?? null,
  writePref: (key: string, value: string) => {
    store.set(key, value);
    return true;
  },
}));
const apiFetch = vi.hoisted(() => vi.fn());
const downloadTopoOverlay = vi.hoisted(() => vi.fn());
const listArtifacts = vi.hoisted(() => vi.fn());
vi.mock("../api/apiFetch", () => ({ apiFetch }));
vi.mock("./overlayDownloads", () => ({ downloadTopoOverlay }));
vi.mock("./registryDb", () => ({ listArtifacts }));
vi.mock("./networkPolicy", () => ({ canRunNow: async () => true }));
vi.mock("react-native", () => ({ AppState: {} }));
vi.mock("../map/connectivity", () => ({ subscribeReconnect: vi.fn() }));

const { runTopoAutoDownload, setTopoAutoDownloadEnabled } = await import(
  "./topoAutoDownload"
);

const layer = (name: string) => ({
  name,
  format: "pmtiles",
  pmtilesUrl: `https://s3.test/${name}`,
});

describe("runTopoAutoDownload dedupe", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    setTopoAutoDownloadEnabled(true);
    apiFetch.mockResolvedValue({
      jobs: [{ jobId: "j1", layers: [layer("contours"), layer("slope")] }],
    });
  });

  // Mutation: mark the key after the download instead of before it.
  it("tries a layer that fails once, not on every foreground", async () => {
    listArtifacts.mockResolvedValue([]);
    downloadTopoOverlay.mockRejectedValue(new Error("offline"));
    await runTopoAutoDownload();
    await runTopoAutoDownload();
    expect(downloadTopoOverlay).toHaveBeenCalledTimes(2);
    expect(
      downloadTopoOverlay.mock.calls.map(([spec]) => spec.layer).sort(),
    ).toEqual(["contours", "slope"]);
  });

  it("never fetches a layer the phone already holds", async () => {
    listArtifacts.mockResolvedValue([
      { kind: "topo-overlay", logicalKey: "j1/contours" },
    ]);
    downloadTopoOverlay.mockResolvedValue(undefined);
    await runTopoAutoDownload();
    expect(downloadTopoOverlay).toHaveBeenCalledOnce();
    expect(downloadTopoOverlay.mock.calls[0][0].layer).toBe("slope");
  });
});
