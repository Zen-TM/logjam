// Regression tests for the two ways a recorder can lie about recording:
// a write chain that stops writing and a resume that marks the row
// live without arming the service.
//
// The native surface is mocked, so this runs on the host: what is under test is
// the ordering and the failure handling, neither of which is device-dependent.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordedTrackPoint } from "@logjam/shared";

type TaskHandler = (event: {
  data?: { locations: unknown[] };
  error?: { code: string } | null;
}) => Promise<void>;

let taskHandler: TaskHandler | null = null;

// The stats recompute is foreground-only, so the batch handler reads
// AppState. Default to active: the existing tests assert the stats write.
const appState = { currentState: "active" as string };
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return appState.currentState;
    },
  },
}));

const getTaskOptionsAsync = vi.fn(async (): Promise<unknown> => null);
vi.mock("expo-task-manager", () => ({
  defineTask: (_name: string, handler: TaskHandler) => {
    taskHandler = handler;
  },
  getTaskOptionsAsync: () => getTaskOptionsAsync(),
}));

const startLocationUpdatesAsync = vi.fn(async () => {});
const hasStartedLocationUpdatesAsync = vi.fn(async () => false);
vi.mock("expo-location", () => ({
  startLocationUpdatesAsync: (...args: unknown[]) =>
    startLocationUpdatesAsync(...(args as [])),
  stopLocationUpdatesAsync: vi.fn(async () => {}),
  hasStartedLocationUpdatesAsync: () => hasStartedLocationUpdatesAsync(),
  ActivityType: { Fitness: 1 },
  Accuracy: { High: 5, Balanced: 3 },
}));

vi.mock("../imports/vectorImports", () => ({ randomId: () => "track-1" }));

// The research logger is native-only and deliberately inert here: what these
// tests assert is the recording path, and the logger's contract is that it
// cannot affect it.
const startSensorLog = vi.fn(async () => false);
const stopSensorLog = vi.fn(() => null);
const deleteSensorLog = vi.fn(async () => {});
vi.mock("./sensorLog", () => ({
  deleteSensorLog: (...args: unknown[]) => deleteSensorLog(...(args as [])),
  startSensorLog: (...args: unknown[]) => startSensorLog(...(args as [])),
  stopSensorLog: () => stopSensorLog(),
}));

// The finish path serialises the recording into a standalone media row.
// That pulls the whole sync/upload stack, none of which exists in this process
// — and none of which these tests are about. `trackBackup.test.ts` covers it.
const backUpFinishedTrack = vi.fn(async () => "media-1");
vi.mock("./trackBackup", () => ({
  backUpFinishedTrack: (...args: unknown[]) =>
    backUpFinishedTrack(...(args as [])),
}));

// The real one reads saved DEM tiles through expo-sqlite; `trackClimb.test.ts`
// covers it. Null is "no saved terrain covers the track".
const climbFromSavedTerrain = vi.fn(
  async (): Promise<{
    elevationGainM: number;
    elevationLossM: number;
    elevationSource: string;
  } | null> => null,
);
vi.mock("./trackClimb", () => ({
  climbFromSavedTerrain: (...args: unknown[]) =>
    climbFromSavedTerrain(...(args as [])),
}));

vi.mock("./recordingPreferences", () => ({
  FIX_RATE_OPTIONS: {
    finest: { timeInterval: 3000, deferredUpdatesInterval: 15_000 },
    balanced: { timeInterval: 30_000, deferredUpdatesInterval: 60_000 },
  },
  readFixRate: () => "balanced",
  readAccuracyLimitM: () => 0,
}));

const appendTrackPoints = vi.fn(async () => {});
const appendRejectedFixes = vi.fn(async () => {});
const addTrackPointSuppression = vi.fn(async () => {});
const updateTrack = vi.fn(async () => {});
const deleteTrack = vi.fn(async () => {});
let activeTrack: Record<string, unknown> | null = null;
let storedPoints: RecordedTrackPoint[] = [];

vi.mock("./tracksDb", () => ({
  appendTrackPoints: (...args: unknown[]) => appendTrackPoints(...(args as [])),
  appendRejectedFixes: (...args: unknown[]) =>
    appendRejectedFixes(...(args as [])),
  addTrackPointSuppression: (...args: unknown[]) =>
    addTrackPointSuppression(...(args as [])),
  updateTrack: (...args: unknown[]) => updateTrack(...(args as [])),
  deleteTrack: (...args: unknown[]) => deleteTrack(...(args as [])),
  insertTrack: vi.fn(async () => {}),
  findActiveTrack: async () => activeTrack,
  getTrack: async () => activeTrack,
  lastTrackPoint: async () => storedPoints.at(-1) ?? null,
  listTrackPoints: async () => storedPoints,
  listTracks: async () => [],
}));

const {
  applyRecordingOptionsToActiveTrack,
  continueTrackRecording,
  finishTrackRecording,
  discardTrackRecording,
  pauseTrackRecording,
  reconcileTrackRecording,
  resumeTrackRecording,
  setRecordingMapFocusBoost,
  startTrackRecording,
} = await import("./trackRecorder");
const {
  isRecordingWriteFailing,
  resetTrackWriteHealth,
  FAILING_WRITE_THRESHOLD,
} = await import("./trackWriteQueue");

/** A fix far enough from the previous one to survive the acceptance filter. */
function fixAt(index: number) {
  return {
    coords: {
      longitude: 150.4 + index * 0.001,
      latitude: -33.5,
      altitude: 500,
      accuracy: 5,
    },
    timestamp: 1_700_000_000_000 + index * 10_000,
  };
}

/** A fix in the SAME place as `fixAt(0)` — inside the drift radius, so the
 *  acceptance filter refuses it as "too-close". */
function stillAt(index: number) {
  return {
    coords: { longitude: 150.4, latitude: -33.5, altitude: 500, accuracy: 5 },
    timestamp: 1_700_000_000_000 + index * 10_000,
  };
}

function recordingTrack() {
  return {
    id: "track-1",
    name: "Track",
    state: "recording",
    color: "#f59e0b",
    visible: true,
    currentSegment: 0,
    distanceM: 0,
    durationMs: 0,
    elevationGainM: 0,
    elevationLossM: 0,
    pointCount: 0,
    startedAt: new Date(1_700_000_000_000).toISOString(),
    endedAt: null,
    pausedMs: 0,
    pausedAt: null,
    updatedAt: new Date(1_700_000_000_000).toISOString(),
  };
}

beforeEach(async () => {
  // One test moves the clock; a failure inside it would otherwise leave every
  // test after it running against a frozen one.
  vi.useRealTimers();
  // The boost is module state and outlives a test. Cleared BEFORE the mocks,
  // so whatever re-registration it causes is not counted against the next test.
  await setRecordingMapFocusBoost(false);
  vi.clearAllMocks();
  getTaskOptionsAsync.mockResolvedValue(null);
  startLocationUpdatesAsync.mockResolvedValue(undefined);
  appendTrackPoints.mockResolvedValue(undefined);
  activeTrack = null;
  storedPoints = [];
  appState.currentState = "active";
  hasStartedLocationUpdatesAsync.mockResolvedValue(false);
  resetTrackWriteHealth();
});

// The fixes the recorder REFUSES are the only positive evidence that anyone
// stood still — a stop and a very slow walk look identical from the accepted
// points alone.
describe("counting the fixes it refuses", () => {
  it("credits a run of too-close fixes to the point they were measured against", async () => {
    activeTrack = recordingTrack();

    await taskHandler!({
      data: { locations: [fixAt(0), stillAt(1), stillAt(2), fixAt(3)] },
    });

    // The mocks are declared without argument types, so the recorded call has
    // to be read back through `unknown`.
    const [, written] = appendTrackPoints.mock.calls[0] as unknown as [
      string,
      RecordedTrackPoint[],
    ];
    expect(written).toHaveLength(2);
    expect(written[0]!.suppressedCount).toBe(2);
    // The last refusal landed 20 s after the point it was measured against.
    expect(written[0]!.stationaryMs).toBe(20_000);
    // Nothing was refused after the second point, and null is "not measured".
    expect(written[1]!.suppressedCount ?? null).toBeNull();
  });

  it("credits them to the STORED point when a whole delivery is refusals", async () => {
    // Standing still at the 30 s rate does exactly this: every fix in the
    // batch is inside the last accepted point's drift radius, so waiting for
    // an accepted point to hang the count on would lose the whole stop.
    activeTrack = recordingTrack();
    storedPoints = [
      {
        lon: 150.4,
        lat: -33.5,
        altitudeM: 500,
        accuracyM: 5,
        timestampMs: 1_700_000_000_000,
        segment: 0,
      },
    ];

    await taskHandler!({ data: { locations: [stillAt(1), stillAt(2)] } });

    expect(appendTrackPoints).not.toHaveBeenCalled();
    expect(addTrackPointSuppression).toHaveBeenCalledWith("track-1", 2, 20_000);
  });
});

describe("a setting change reaches the recording in progress", () => {
  it("re-registers the running task with the new options", async () => {
    hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await expect(applyRecordingOptionsToActiveTrack()).resolves.toBe(true);
    expect(startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    const [, options] = startLocationUpdatesAsync.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(options).toMatchObject({ timeInterval: 30_000 });
  });

  it("does nothing when no recording is running", async () => {
    await expect(applyRecordingOptionsToActiveTrack()).resolves.toBe(false);
    expect(startLocationUpdatesAsync).not.toHaveBeenCalled();
  });
});

describe("the map boost", () => {
  // The map's 3 s watcher does not speed the recorder up (expo-location pins
  // each client's minimum update interval to its own interval), so the recorder
  // is boosted explicitly while the map is looked at.
  function lastOptions() {
    const [, options] = startLocationUpdatesAsync.mock.calls.at(
      -1,
    ) as unknown as [string, Record<string, unknown>];
    return options;
  }

  it("records at the finest rate while boosted, and at the user's rate after", async () => {
    hasStartedLocationUpdatesAsync.mockResolvedValue(true);

    await expect(setRecordingMapFocusBoost(true)).resolves.toBe(true);
    expect(lastOptions()).toMatchObject({
      timeInterval: 3000,
      deferredUpdatesInterval: 15_000,
    });

    await expect(setRecordingMapFocusBoost(false)).resolves.toBe(true);
    expect(lastOptions()).toMatchObject({
      timeInterval: 30_000,
      deferredUpdatesInterval: 60_000,
    });
    expect(startLocationUpdatesAsync).toHaveBeenCalledTimes(2);
  });

  it("re-registers once for a repeated boost", async () => {
    hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await setRecordingMapFocusBoost(true);
    await expect(setRecordingMapFocusBoost(true)).resolves.toBe(false);
    expect(startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no recording is running", async () => {
    await expect(setRecordingMapFocusBoost(true)).resolves.toBe(false);
    expect(startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it("starts a recording boosted when the map is already being looked at", async () => {
    await setRecordingMapFocusBoost(true);
    await startTrackRecording();
    expect(lastOptions()).toMatchObject({ timeInterval: 3000 });
  });

  // THE REASON THE FLAG IS NOT CLEARED ON STOP: a pause and resume without
  // leaving the map changes nothing the map's effect is keyed on, so a flag
  // reset by the pause would resume at 30 s under a user staring at the map.
  it("survives a pause and resume on the map", async () => {
    hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await setRecordingMapFocusBoost(true);
    await pauseTrackRecording("track-1");
    const track = {
      ...recordingTrack(),
      state: "paused",
      pausedAt: new Date().toISOString(),
    };
    await resumeTrackRecording(track as never);
    expect(lastOptions()).toMatchObject({ timeInterval: 3000 });
  });

  // A process that died boosted leaves the platform delivering at 3 s, and a
  // relaunch that opens on another tab never runs the map's effect to undo it.
  it("reconcile turns a boost persisted across a process death back down", async () => {
    activeTrack = recordingTrack();
    hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    getTaskOptionsAsync.mockResolvedValue({ timeInterval: 3000 });

    await reconcileTrackRecording();

    expect(startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(lastOptions()).toMatchObject({ timeInterval: 30_000 });
  });

  it("reconcile leaves a recorder already at the right rate alone", async () => {
    activeTrack = recordingTrack();
    hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    getTaskOptionsAsync.mockResolvedValue({ timeInterval: 30_000 });

    await reconcileTrackRecording();

    expect(startLocationUpdatesAsync).not.toHaveBeenCalled();
  });
});

describe("a backgrounded recorder only writes points", () => {
  // The stats are display-only. Recomputing them per batch is avoided because it
  // requires a full read of the series plus O(points) of arithmetic in a
  // background task. They are settled on return to the foreground instead
  // (refreshActiveTrackStats), so the only cost is a HUD that is one batch
  // stale at the moment the screen comes back on.
  it("appends without recomputing stats while backgrounded", async () => {
    activeTrack = recordingTrack();
    appState.currentState = "background";

    await taskHandler!({ data: { locations: [fixAt(0), fixAt(1)] } });

    expect(appendTrackPoints).toHaveBeenCalledTimes(1);
    expect(updateTrack).not.toHaveBeenCalled();
  });

  it("does recompute them while Logjam GPS is in front of someone", async () => {
    activeTrack = recordingTrack();

    await taskHandler!({ data: { locations: [fixAt(0), fixAt(1)] } });

    expect(appendTrackPoints).toHaveBeenCalledTimes(1);
    expect(updateTrack).toHaveBeenCalledTimes(1);
  });
});

describe("location batch write chain", () => {
  it("keeps writing after a failed batch instead of poisoning the chain", async () => {
    activeTrack = recordingTrack();
    expect(taskHandler).not.toBeNull();

    appendTrackPoints.mockRejectedValueOnce(new Error("database is locked"));
    await taskHandler!({ data: { locations: [fixAt(0)] } });
    expect(appendTrackPoints).toHaveBeenCalledTimes(1);

    // THE REGRESSION: with `chain = chain.then(write)` and no rejection
    // handler, this delivery never reaches appendTrackPoints at all — and
    // every one after it, for the life of the process.
    await taskHandler!({ data: { locations: [fixAt(1)] } });
    expect(appendTrackPoints).toHaveBeenCalledTimes(2);
    expect(updateTrack).toHaveBeenCalled();
  });

  it("reports the recording as failing after a run of failures, and recovers", async () => {
    activeTrack = recordingTrack();
    appendTrackPoints.mockRejectedValue(new Error("no space left on device"));
    for (let i = 0; i < FAILING_WRITE_THRESHOLD; i++) {
      await taskHandler!({ data: { locations: [fixAt(i)] } });
    }
    expect(isRecordingWriteFailing()).toBe(true);

    appendTrackPoints.mockResolvedValue(undefined);
    await taskHandler!({ data: { locations: [fixAt(9)] } });
    expect(isRecordingWriteFailing()).toBe(false);
  });

  it("does not reject into the task callback", async () => {
    activeTrack = recordingTrack();
    appendTrackPoints.mockRejectedValue(new Error("database is locked"));
    await expect(
      taskHandler!({ data: { locations: [fixAt(0)] } }),
    ).resolves.toBeUndefined();
  });
});

describe("arming and marking", () => {
  it("restores the pause when resume cannot arm the location task", async () => {
    const pausedAt = new Date(1_700_000_100_000).toISOString();
    const track = {
      ...recordingTrack(),
      state: "paused",
      currentSegment: 2,
      pausedMs: 60_000,
      pausedAt,
    };
    startLocationUpdatesAsync.mockRejectedValueOnce(
      new Error("permission denied"),
    );

    await expect(resumeTrackRecording(track as never)).rejects.toThrow();

    // Marked recording, then put back exactly as it was — no live-looking
    // dead recorder, and the pause clock is not silently closed out.
    expect(updateTrack).toHaveBeenCalledTimes(2);
    expect(updateTrack).toHaveBeenLastCalledWith("track-1", {
      state: "paused",
      currentSegment: 2,
      pausedMs: 60_000,
      pausedAt,
    });
  });

  it("leaves the row recording when the task arms", async () => {
    const track = {
      ...recordingTrack(),
      state: "paused",
      currentSegment: 2,
      pausedMs: 60_000,
    };
    await resumeTrackRecording(track as never);
    expect(updateTrack).toHaveBeenCalledTimes(1);
    expect(updateTrack).toHaveBeenLastCalledWith("track-1", {
      state: "recording",
      currentSegment: 3,
      pausedMs: 60_000,
      pausedAt: null,
    });
  });

  it("drops the row when starting cannot arm the location task", async () => {
    startLocationUpdatesAsync.mockRejectedValueOnce(new Error("location off"));
    await expect(startTrackRecording()).rejects.toThrow();
    expect(deleteTrack).toHaveBeenCalledWith("track-1");
  });

  it("puts a continued track BACK to finished when the task won't arm", async () => {
    const endedAt = new Date(1_700_000_600_000).toISOString();
    const track = {
      ...recordingTrack(),
      state: "done",
      currentSegment: 2,
      pausedMs: 60_000,
      endedAt,
    };
    startLocationUpdatesAsync.mockRejectedValueOnce(
      new Error("permission denied"),
    );

    await expect(continueTrackRecording(track as never)).rejects.toThrow();

    // Un-finishing a saved track and then failing to record is the worst of
    // both: the row must end up exactly as finished as it started.
    expect(updateTrack).toHaveBeenCalledTimes(2);
    expect(updateTrack).toHaveBeenLastCalledWith("track-1", {
      state: "done",
      currentSegment: 2,
      pausedMs: 60_000,
      endedAt,
    });
  });

  it("continues into a NEW segment and bills the gap since the finish as paused", async () => {
    const endedAt = new Date(1_700_000_600_000).toISOString();
    // 5 minutes after the finish tap.
    vi.setSystemTime(1_700_000_900_000);
    const track = {
      ...recordingTrack(),
      state: "done",
      currentSegment: 2,
      pausedMs: 60_000,
      endedAt,
    };

    await continueTrackRecording(track as never);

    expect(updateTrack).toHaveBeenCalledTimes(1);
    expect(updateTrack).toHaveBeenLastCalledWith("track-1", {
      state: "recording",
      // A new segment, so the line breaks across the gap rather than drawing a
      // teleport from the exit back to wherever the party restarted.
      currentSegment: 3,
      pausedMs: 60_000 + 300_000,
      endedAt: null,
      pausedAt: null,
    });
    vi.useRealTimers();
  });

  it("refuses to continue while another recording is live", async () => {
    activeTrack = recordingTrack();
    const track = { ...recordingTrack(), id: "track-2", state: "done" };
    await expect(continueTrackRecording(track as never)).rejects.toThrow(
      /already being recorded/,
    );
    expect(updateTrack).not.toHaveBeenCalled();
  });
});

describe("rejected fixes are kept, and cannot cost a recording", () => {
  // Diagnosing fix quality requires comparing against later fixes; storing
  // refused fixes preserves the raw data needed to evaluate candidate filters.
  it("stores a refused fix with the reason the filter gave", async () => {
    activeTrack = recordingTrack();

    // fixAt(0) is accepted; stillAt(1) is inside the drift radius.
    await taskHandler!({ data: { locations: [fixAt(0), stillAt(1)] } });

    expect(appendRejectedFixes).toHaveBeenCalledTimes(1);
    const [trackId, rejected] = appendRejectedFixes.mock
      .calls[0] as unknown as [
      string,
      { reason: string; segment: number; lon: number }[],
    ];
    expect(trackId).toBe("track-1");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe("too-close");
    expect(rejected[0]!.segment).toBe(0);
  });

  it("writes nothing when every fix was accepted", async () => {
    activeTrack = recordingTrack();

    await taskHandler!({ data: { locations: [fixAt(0), fixAt(1)] } });

    expect(appendTrackPoints).toHaveBeenCalledTimes(1);
    expect(appendRejectedFixes).not.toHaveBeenCalled();
  });

  // THE POINT OF THE SEPARATION: this table is diagnostic, so a failure writing
  // it must not reach the write the trip depends on. A throw here must not
  // propagate out of handleLocationBatch or prevent accepted points from being
  // appended.
  it("still appends the accepted points when the diagnostic write throws", async () => {
    activeTrack = recordingTrack();
    appendRejectedFixes.mockRejectedValueOnce(new Error("database is locked"));

    await taskHandler!({
      data: { locations: [fixAt(0), stillAt(1), fixAt(2)] },
    });

    expect(appendRejectedFixes).toHaveBeenCalledTimes(1);
    expect(appendTrackPoints).toHaveBeenCalledTimes(1);
    const [, points] = appendTrackPoints.mock.calls[0] as unknown as [
      string,
      RecordedTrackPoint[],
    ];
    expect(points).toHaveLength(2);
  });
});

describe("a finished track's climb and descent", () => {
  /** Two fixes 1 km apart that the recorded altitudes say climb 400 m. */
  function climbingPoints(): RecordedTrackPoint[] {
    return [0, 1].map((index) => ({
      lon: 150.4 + index * 0.01,
      lat: -33.5,
      altitudeM: 500 + index * 400,
      timestampMs: 1_700_000_000_000 + index * 600_000,
      segment: 0,
    })) as RecordedTrackPoint[];
  }
  const savedStats = () =>
    (
      updateTrack.mock.calls.at(-1) as unknown as [
        string,
        {
          stats: {
            elevationGainM: number;
            elevationLossM: number;
            elevationSource?: string;
          };
        },
      ]
    )[1].stats;

  beforeEach(() => {
    activeTrack = recordingTrack();
    storedPoints = climbingPoints();
  });

  // Mutation: drop the `climbFromSavedTerrain` spread in `finishTrackRecording`
  // and the row goes back to the recorded 400 m with no source.
  it("come from the saved terrain, with its source, when it covers the track", async () => {
    const climb = {
      elevationGainM: 12,
      elevationLossM: 34,
      elevationSource: "nsw-5m",
    };
    climbFromSavedTerrain.mockResolvedValueOnce(climb);

    await finishTrackRecording("track-1");

    expect(savedStats()).toMatchObject(climb);
    // The backed-up file's metadata is built from the same row.
    expect(
      (backUpFinishedTrack.mock.calls.at(-1) as unknown as [unknown])[0],
    ).toMatchObject(climb);
  });

  it("stay as recorded, with no source, where no saved terrain covers it", async () => {
    climbFromSavedTerrain.mockResolvedValueOnce(null);

    await finishTrackRecording("track-1");

    expect(savedStats().elevationGainM).toBe(400);
    expect(savedStats().elevationSource).toBeUndefined();
  });
});

describe("the research log ends with its recording", () => {
  it("a discarded recording takes its log file with it", async () => {
    // Mutation: drop `deleteSensorLog` from `discardTrackRecording`. The log
    // of a discarded recording was left behind for a track that no longer
    // exists.
    await discardTrackRecording("track-1");
    expect(stopSensorLog).toHaveBeenCalled();
    expect(deleteTrack).toHaveBeenCalledWith("track-1");
    expect(deleteSensorLog).toHaveBeenCalledWith("track-1");
  });

  it("reconcile stops the log of a recorder that died", async () => {
    // Mutation: mark the row paused in `reconcileTrackRecording` without
    // going through `stopLocationUpdatesIfRunning`.
    activeTrack = {
      id: "track-1",
      state: "recording",
      startedAt: "2026-01-01",
    };
    hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    await reconcileTrackRecording();
    expect(stopSensorLog).toHaveBeenCalled();
  });
});
