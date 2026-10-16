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
let onCancel: () => void = () => {};
const service = {
  show: vi.fn(),
  stop: vi.fn(),
  addListener: (_event: string, handler: () => void) => {
    onCancel = handler;
  },
};
vi.mock(
  "../../modules/logjam-download-service/src/LogjamDownloadServiceModule",
  () => ({ default: service }),
);
vi.mock("./networkPolicy", () => ({ connectionWorthResuming: () => false }));
// Every run finds no connection.
vi.mock("./regionMbtiles", () => ({ deleteRegionFile: vi.fn() }));
vi.mock("./regionDownloads", () => ({ deleteDownloadedArtifact: vi.fn() }));
vi.mock("./regionTileDownload", () => ({
  connectionAllows: () => Promise.resolve(false),
  runRegionDownload: () =>
    Promise.resolve({ status: "paused", reason: "connectivity" }),
}));

const {
  cancelAllRegionDownloads,
  enqueueRegionDownloads,
  pauseRegionDownload,
} = await import("./regionDownloadQueue");
const { deleteRegionFile } = await import("./regionMbtiles");

const job = (id: string) => ({
  taskKind: "tile-pyramid" as const,
  id,
  basemapId: "six-topo" as const,
  label: "Topo",
  groupId: `group-${id}`,
  groupLabel: "Area",
  bbox: { west: 150.2, south: -33.7, east: 150.3, north: -33.6 },
  zMax: 14,
  allowCellular: false,
});

beforeEach(async () => {
  await cancelAllRegionDownloads();
  vi.mocked(deleteRegionFile).mockClear();
  vi.useFakeTimers();
  appState.currentState = "active";
  service.show.mockClear();
  service.stop.mockClear();
});

describe("a download waiting for a connection", () => {
  // If the wait were timed from when the job paused, minutes spent waiting with
  // Logjam GPS in front would come off what it was allowed behind another app.
  // Mutation: leave the wait timer running across an app state change.
  it("gets the whole wait behind another app, however long it waited in front", async () => {
    enqueueRegionDownloads([job("job-1")]);
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

    // And the wait is still bounded ([0013](../../../docs/decisions/0013-background-work-battery-rules.md)).
    await vi.advanceTimersByTimeAsync(BACKGROUND_WAIT_MS);
    expect(service.stop).toHaveBeenCalled();
  });
});

describe("Cancel on the notification", () => {
  // Mutation: cancel every job in the queue. A download the user paused by
  // hand is then deleted by a button on a notification that was not about it.
  it("ends what the notification stands for and leaves a user's pause alone", async () => {
    enqueueRegionDownloads([job("waiting"), job("paused-by-hand")]);
    await vi.advanceTimersByTimeAsync(0);
    pauseRegionDownload("paused-by-hand");

    onCancel();
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.mocked(deleteRegionFile).mock.calls).toEqual([["waiting"]]);
    expect(service.stop).toHaveBeenCalled();
  });
});
