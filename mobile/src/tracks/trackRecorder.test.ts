// Regression tests for the two ways a recorder can lie about recording:
// a write chain that stops writing (MLIFE-001) and a resume that marks the row
// live without arming the service (MLIFE-002). Both were invisible to a green
// suite, and both cost the user the rest of their trip.
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

// The stats recompute is foreground-only now, so the batch handler reads
// AppState. Default to active: the existing tests assert the stats write.
const appState = { currentState: "active" as string };
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return appState.currentState;
    },
  },
}));

vi.mock("expo-task-manager", () => ({
  defineTask: (_name: string, handler: TaskHandler) => {
    taskHandler = handler;
  },
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

vi.mock("./recordingPreferences", () => ({
  FIX_RATE_OPTIONS: { balanced: { timeInterval: 30_000 } },
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
  resumeTrackRecording,
  startTrackRecording,
} = await import("./trackRecorder");
const { isRecordingWriteFailing, resetTrackWriteHealth, FAILING_WRITE_THRESHOLD } =
  await import("./trackWriteQueue");

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

beforeEach(() => {
  // One test moves the clock; a failure inside it would otherwise leave every
  // test after it running against a frozen one.
  vi.useRealTimers();
  vi.clearAllMocks();
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
// points alone. Losing them is what the platform `distanceInterval` used to do.
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

describe("a backgrounded recorder only writes points", () => {
  // The stats are display-only. Recomputing them per batch meant a full read of
  // the series plus O(points) of arithmetic for every fix of a trip, in a
  // headless task nobody was looking at — and it got more expensive the longer
  // the recording ran. They are settled on return to the foreground instead
  // (refreshActiveTrackStats), so the only thing this may cost is a HUD that is
  // one batch stale at the moment the screen comes back on.
  it("appends without recomputing stats while backgrounded", async () => {
    activeTrack = recordingTrack();
    appState.currentState = "background";

    await taskHandler!({ data: { locations: [fixAt(0), fixAt(1)] } });

    expect(appendTrackPoints).toHaveBeenCalledTimes(1);
    expect(updateTrack).not.toHaveBeenCalled();
  });

  it("does recompute them while the app is in front of someone", async () => {
    activeTrack = recordingTrack();

    await taskHandler!({ data: { locations: [fixAt(0), fixAt(1)] } });

    expect(appendTrackPoints).toHaveBeenCalledTimes(1);
    expect(updateTrack).toHaveBeenCalledTimes(1);
  });
});

describe("location batch write chain (MLIFE-001)", () => {
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

describe("arming and marking (MLIFE-002)", () => {
  it("restores the pause when resume cannot arm the location task", async () => {
    const pausedAt = new Date(1_700_000_100_000).toISOString();
    const track = { ...recordingTrack(), state: "paused", currentSegment: 2, pausedMs: 60_000, pausedAt };
    startLocationUpdatesAsync.mockRejectedValueOnce(new Error("permission denied"));

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
    const track = { ...recordingTrack(), state: "paused", currentSegment: 2, pausedMs: 60_000 };
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
    startLocationUpdatesAsync.mockRejectedValueOnce(new Error("permission denied"));

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
  // Every diagnosis of a bad fix so far needed the fix AFTER it, and a refused
  // fix used to be unrecoverable — so no candidate filter could be tested
  // against the fixes it would have to judge. See private/todo/track-accuracy.md.
  it("stores a refused fix with the reason the filter gave", async () => {
    activeTrack = recordingTrack();

    // fixAt(0) is accepted; stillAt(1) is inside the drift radius.
    await taskHandler!({ data: { locations: [fixAt(0), stillAt(1)] } });

    expect(appendRejectedFixes).toHaveBeenCalledTimes(1);
    const [trackId, rejected] = appendRejectedFixes.mock.calls[0] as unknown as [
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
  // it must not reach the write the trip depends on. Before the try/catch, a
  // throw here propagated out of handleLocationBatch and the batch's accepted
  // points were never appended.
  it("still appends the accepted points when the diagnostic write throws", async () => {
    activeTrack = recordingTrack();
    appendRejectedFixes.mockRejectedValueOnce(new Error("database is locked"));

    await taskHandler!({ data: { locations: [fixAt(0), stillAt(1), fixAt(2)] } });

    expect(appendRejectedFixes).toHaveBeenCalledTimes(1);
    expect(appendTrackPoints).toHaveBeenCalledTimes(1);
    const [, points] = appendTrackPoints.mock.calls[0] as unknown as [
      string,
      RecordedTrackPoint[],
    ];
    expect(points).toHaveLength(2);
  });
});
