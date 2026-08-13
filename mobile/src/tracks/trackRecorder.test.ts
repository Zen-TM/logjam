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

vi.mock("expo-task-manager", () => ({
  defineTask: (_name: string, handler: TaskHandler) => {
    taskHandler = handler;
  },
}));

const startLocationUpdatesAsync = vi.fn(async () => {});
vi.mock("expo-location", () => ({
  startLocationUpdatesAsync: (...args: unknown[]) =>
    startLocationUpdatesAsync(...(args as [])),
  stopLocationUpdatesAsync: vi.fn(async () => {}),
  hasStartedLocationUpdatesAsync: vi.fn(async () => false),
  ActivityType: { Fitness: 1 },
  Accuracy: { High: 5, Balanced: 3 },
}));

vi.mock("../imports/vectorImports", () => ({ randomId: () => "track-1" }));

vi.mock("./recordingPreferences", () => ({
  FIX_RATE_OPTIONS: { high: {} },
  readFixRate: () => "high",
  readAccuracyLimitM: () => 0,
}));

const appendTrackPoints = vi.fn(async () => {});
const updateTrack = vi.fn(async () => {});
const deleteTrack = vi.fn(async () => {});
let activeTrack: Record<string, unknown> | null = null;
let storedPoints: RecordedTrackPoint[] = [];

vi.mock("./tracksDb", () => ({
  appendTrackPoints: (...args: unknown[]) => appendTrackPoints(...(args as [])),
  updateTrack: (...args: unknown[]) => updateTrack(...(args as [])),
  deleteTrack: (...args: unknown[]) => deleteTrack(...(args as [])),
  insertTrack: vi.fn(async () => {}),
  findActiveTrack: async () => activeTrack,
  getTrack: async () => activeTrack,
  lastTrackPoint: async () => storedPoints.at(-1) ?? null,
  listTrackPoints: async () => storedPoints,
}));

const {
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
  vi.clearAllMocks();
  startLocationUpdatesAsync.mockResolvedValue(undefined);
  appendTrackPoints.mockResolvedValue(undefined);
  activeTrack = null;
  storedPoints = [];
  resetTrackWriteHealth();
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
});
