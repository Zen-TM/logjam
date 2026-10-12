import { beforeEach, describe, expect, it, vi } from "vitest";

import { BACKGROUND_WAIT_MS } from "./regionDownloadGroups";

// The queue's own state machine around the foreground service. Everything
// native is stubbed: what is under test is when the service is told to stop.

const appState = { currentState: "active" as string };
let onAppState: (state: string) => void = () => {};
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, handler: (state: string) => void) => {
      onAppState = handler;
      return { remove: () => {} };
    },
    get currentState() {
      return appState.currentState;
    },
  },
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: () => () => {} },
}));
const service = { show: vi.fn(), stop: vi.fn() };
vi.mock(
  "../../modules/logjam-download-service/src/LogjamDownloadServiceModule",
  () => ({ default: service }),
);
vi.mock("./networkPolicy", () => ({ connectionWorthResuming: () => false }));
// Every run finds no connection.
vi.mock("./regionTileDownload", () => ({
  connectionAllows: () => Promise.resolve(false),
  runRegionDownload: () =>
    Promise.resolve({ status: "paused", reason: "connectivity" }),
}));

const { enqueueRegionDownloads } = await import("./regionDownloadQueue");

beforeEach(() => {
  vi.useFakeTimers();
  appState.currentState = "active";
  service.show.mockClear();
  service.stop.mockClear();
});

describe("a download waiting for a connection", () => {
  // The wait was timed from when the job paused, so minutes spent waiting with
  // Logjam GPS in front came off what it was allowed behind another app.
  // Mutation: leave the wait timer running across an app state change.
  it("gets the whole wait behind another app, however long it waited in front", async () => {
    enqueueRegionDownloads([
      {
        taskKind: "tile-pyramid",
        id: "job-1",
        basemapId: "six-topo",
        label: "Topo",
        groupId: "group-1",
        groupLabel: "Area",
        bbox: { west: 150.2, south: -33.7, east: 150.3, north: -33.6 },
        zMax: 14,
        allowCellular: false,
      },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(service.show).toHaveBeenLastCalledWith(
      "Downloading maps",
      "Waiting for a connection",
      expect.any(Number),
    );

    await vi.advanceTimersByTimeAsync(BACKGROUND_WAIT_MS - 30_000);
    appState.currentState = "background";
    onAppState("background");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.stop).not.toHaveBeenCalled();

    // And the wait is still bounded (ADR 0013).
    await vi.advanceTimersByTimeAsync(BACKGROUND_WAIT_MS);
    expect(service.stop).toHaveBeenCalled();
  });
});
