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
const swapSuperseded = vi.hoisted(() =>
  vi.fn((_artifact: unknown, _failed: number) => Promise.resolve(true)),
);
const renameArtifactGroup = vi.hoisted(() => vi.fn());
vi.mock("./registryDb", () => ({ renameArtifactGroup }));
vi.mock("./regionDownloads", () => ({
  deleteClipFile: vi.fn(),
  deleteDownloadedArtifact: vi.fn(),
  swapSuperseded,
}));
const runRegionDownload = vi.hoisted(() =>
  vi.fn(
    (): Promise<unknown> =>
      Promise.resolve({ status: "paused", reason: "connectivity" }),
  ),
);
vi.mock("./regionTileDownload", () => ({
  connectionAllows: () => Promise.resolve(false),
  runRegionDownload,
}));

const keepLatestWeather = vi.hoisted(() =>
  vi.fn((..._args: unknown[]) => Promise.resolve()),
);
vi.mock("../weatherMap/weatherMapKeep", () => ({ keepLatestWeather }));
const wipeEpoch = vi.hoisted(() => ({ value: 7 }));
vi.mock("../weatherMap/weatherMapEpoch", () => ({
  weatherMapEpoch: () => wipeEpoch.value,
}));

const {
  cancelAllRegionDownloads,
  enqueueRegionDownloads,
  onRegionDownloadToast,
  pauseRegionDownload,
  renameRegionGroup,
  resumeRegionDownload,
  stopRegionGroup,
} = await import("./regionDownloadQueue");
const { deleteRegionFile } = await import("./regionMbtiles");
const { deleteDownloadedArtifact } = await import("./regionDownloads");

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

describe("the weather run kept with a saved area", () => {
  const BLUE_MOUNTAINS = {
    west: 150.2,
    south: -33.7,
    east: 150.3,
    north: -33.6,
  };
  const PERTH = { west: 115.8, south: -32, east: 116, north: -31.9 };

  // Mutation: drop the call from `enqueueRegionDownloads`, and an area saved
  // or updated keeps no weather run for the overlay to draw offline; pass
  // `false` for `allowCellular`, and a download the user allowed on mobile
  // data is refused its weather; pass `specs[0]`'s box alone, and a batch
  // whose first area is elsewhere keeps nothing for the others.
  it("is asked for once per download, with every box and its connection answer", async () => {
    keepLatestWeather.mockClear();
    enqueueRegionDownloads([
      { ...job("w-1"), bbox: PERTH, allowCellular: true },
      { ...job("w-2"), allowCellular: true },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(keepLatestWeather.mock.calls).toEqual([
      [true, [PERTH, BLUE_MOUNTAINS], 7],
    ]);
  });

  // Mutation: read the epoch inside the dynamic import's `then`, and a wipe
  // that lands while the module loads is the epoch the keep starts in.
  it("passes the wipe epoch read before the import resolves", async () => {
    keepLatestWeather.mockClear();
    wipeEpoch.value = 3;
    enqueueRegionDownloads([job("w-3")]);
    wipeEpoch.value = 4;
    await vi.advanceTimersByTimeAsync(0);
    expect(keepLatestWeather.mock.calls[0]?.[2]).toBe(3);
    wipeEpoch.value = 7;
  });

  // Mutation: drop the call from `resumeRegionDownload`, and a Retry on a
  // stopped download never brings the weather the body says it does.
  it("is asked for again on a Retry", async () => {
    enqueueRegionDownloads([{ ...job("w-4"), allowCellular: true }]);
    await vi.advanceTimersByTimeAsync(0);
    keepLatestWeather.mockClear();
    resumeRegionDownload("w-4");
    await vi.advanceTimersByTimeAsync(0);
    expect(keepLatestWeather.mock.calls).toEqual([[true, [BLUE_MOUNTAINS], 7]]);
  });
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

describe("a runner that throws", () => {
  // Mutation: await the runner unguarded and the second job never runs: the
  // first stays "downloading" with its token held, and the queue stalls.
  it("fails its own job and lets the next one run", async () => {
    runRegionDownload.mockClear();
    runRegionDownload.mockRejectedValueOnce(new Error("boom"));
    enqueueRegionDownloads([job("throws"), job("next")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(runRegionDownload).toHaveBeenCalledTimes(2);
  });
});

describe("an update", () => {
  const ready = (artifact: object, failed = 0) => ({
    status: "ready",
    artifact,
    gaps: 0,
    failed,
  });

  // Mutation: swap before the run settles, or for a run that did not finish,
  // and a failed update leaves the user without the map they had.
  it("swaps the old file out only after the new one is saved", async () => {
    swapSuperseded.mockClear();
    runRegionDownload.mockResolvedValueOnce({
      status: "failed",
      code: "unknown",
    });
    enqueueRegionDownloads([job("fails")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(swapSuperseded).not.toHaveBeenCalled();
    const artifact = { id: "new" };
    runRegionDownload.mockResolvedValueOnce(ready(artifact, 2));
    enqueueRegionDownloads([job("saves")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(swapSuperseded).toHaveBeenCalledWith(artifact, 2);
  });

  // Mutation: ignore swapSuperseded's answer, and a download too poor to
  // replace the older copy is reported as saved.
  it("reports a download that could not replace the old copy as failed", async () => {
    const toasts: { tone: string }[] = [];
    const stop = onRegionDownloadToast((message) => toasts.push(message));
    swapSuperseded.mockResolvedValueOnce(false);
    runRegionDownload.mockResolvedValueOnce(ready({ id: "holey" }, 3));
    enqueueRegionDownloads([job("holey")]);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(toasts.at(-1)).toMatchObject({ tone: "error" });
  });

  // Mutation: have Saved's rename call renameArtifactGroup alone, and the
  // files still downloading are written under the old name.
  it("writes the files still to come under a name given meanwhile", async () => {
    runRegionDownload.mockClear();
    const a = { ...job("one"), groupId: "g" };
    const b = { ...job("two"), groupId: "g" };
    enqueueRegionDownloads([a, b]);
    await renameRegionGroup("g", "Renamed");
    await vi.advanceTimersByTimeAsync(0);
    expect((runRegionDownload.mock.calls as unknown[][])[1]?.[0]).toMatchObject(
      {
        groupLabel: "Renamed",
      },
    );
    expect(renameArtifactGroup).toHaveBeenCalledWith("g", "Renamed");
  });
});

describe("stopping an update", () => {
  const updateJob = (id: string) => ({
    ...job(id),
    groupId: "card",
    update: true as const,
  });
  const jobOf = (id: string, kind: "ready" | "paused") => ({
    spec: { ...updateJob(id) },
    state:
      kind === "ready"
        ? ({ kind: "ready", gaps: 0, failed: 0 } as const)
        : ({ kind: "paused", reason: "connectivity" } as const),
    progress: {} as never,
  });
  const ready = (id: string) => ({
    status: "ready",
    artifact: { id },
    gaps: 0,
    failed: 0,
  });

  // Mutation: stop every job of an update, as a first save does, and the
  // files it already saved, which took their older copies' place, go too.
  it("keeps the files it already saved", async () => {
    vi.mocked(deleteDownloadedArtifact).mockClear();
    runRegionDownload.mockResolvedValueOnce(ready("done"));
    enqueueRegionDownloads([updateJob("done"), updateJob("waiting")]);
    await vi.advanceTimersByTimeAsync(0);
    stopRegionGroup({
      groupId: "card",
      update: true,
      jobs: [jobOf("done", "ready"), jobOf("waiting", "paused")],
    });
    await vi.advanceTimersByTimeAsync(0);
    const deleted = vi.mocked(deleteDownloadedArtifact).mock.calls.flat();
    expect(deleted).toContain("waiting");
    expect(deleted).not.toContain("done");
  });

  it("stops everything a first save wrote", async () => {
    vi.mocked(deleteDownloadedArtifact).mockClear();
    const first = (id: string) => ({ ...job(id), groupId: "card" });
    runRegionDownload.mockResolvedValueOnce(ready("done"));
    enqueueRegionDownloads([first("done"), first("waiting")]);
    await vi.advanceTimersByTimeAsync(0);
    stopRegionGroup({
      groupId: "card",
      update: false,
      jobs: [jobOf("done", "ready"), jobOf("waiting", "paused")],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(deleteDownloadedArtifact).mock.calls.flat()).toContain(
      "done",
    );
  });

  // Mutation: announce a stopped run, and what is left of an update the user
  // cut short is reported as "updated".
  it("says nothing of a run the user stopped", async () => {
    const toasts: unknown[] = [];
    const stop = onRegionDownloadToast((message) => toasts.push(message));
    runRegionDownload.mockResolvedValueOnce({
      status: "ready",
      artifact: { id: "a" },
      gaps: 0,
      failed: 0,
    });
    enqueueRegionDownloads([updateJob("a"), updateJob("b")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts).toEqual([]);
    stopRegionGroup({
      groupId: "card",
      update: true,
      jobs: [jobOf("a", "ready"), jobOf("b", "paused")],
    });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(toasts).toEqual([]);
  });
});
