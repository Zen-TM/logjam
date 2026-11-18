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
const appState = vi.hoisted(() => ({
  currentState: "active",
  addEventListener: () => ({ remove: () => {} }),
}));
const subscribeReconnect = vi.hoisted(() =>
  vi.fn((_onReconnect: () => void) => () => {}),
);
vi.mock("react-native", () => ({ AppState: appState }));
vi.mock("../map/connectivity", () => ({ subscribeReconnect }));

const {
  registerTopoAutoDownload,
  runTopoAutoDownload,
  setTopoAutoDownloadEnabled,
} = await import("./topoAutoDownload");

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

describe("a regained signal", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    appState.currentState = "active";
    setTopoAutoDownloadEnabled(true);
    apiFetch.mockResolvedValue({ jobs: [] });
  });

  /** Registers, then fires the reconnect edge the way NetInfo would. */
  const reconnect = async () => {
    const cleanup = registerTopoAutoDownload();
    const onReconnect = subscribeReconnect.mock.calls[0][0];
    await vi.advanceTimersByTimeAsync(60_000);
    apiFetch.mockClear();
    onReconnect();
    await vi.advanceTimersByTimeAsync(0);
    cleanup();
  };

  // Mutation: drop the `=== "background"` return from `requestRun`.
  it("fetches nothing while the app is in the background (ADR 0013)", async () => {
    appState.currentState = "background";
    await reconnect();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  // Mutation: invert the guard in `requestRun` to `!== "background"`, and
  // nothing runs in front.
  it("checks when the app is in front", async () => {
    await reconnect();
    expect(apiFetch).toHaveBeenCalledOnce();
  });

  // Android reports "unknown" until the first AppState event, and the check at
  // launch runs inside that window.
  // Mutation: `!== "active"` in `requestRun`.
  it("checks while AppState is still unknown", async () => {
    appState.currentState = "unknown";
    await reconnect();
    expect(apiFetch).toHaveBeenCalledOnce();
  });
});
