// What has to hold when a finished recording becomes a file on the account:
// the stats it carries are the recorder's own and survive the API's own
// validator, and a failure anywhere in the chain costs the user nothing but a
// retry — the track row is never touched by one, and no half-written GPX is
// left behind for the next attempt to trip over.
//
// The filesystem and the sync stack are mocked: what is under test is the
// ordering and the failure handling, neither of which is device-dependent.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordedTrackPoint } from "@logjam/shared";

const STORE = "file:///documents/recorded-tracks/";
vi.mock("../offline/localStores", () => ({ RECORDED_TRACK_DIR: STORE }));

const written: { path: string; content: string }[] = [];
const deleted: string[] = [];
vi.mock("expo-file-system/legacy", () => ({
  makeDirectoryAsync: vi.fn(async () => {}),
  writeAsStringAsync: vi.fn(async (path: string, content: string) => {
    written.push({ path, content });
  }),
  deleteAsync: vi.fn(async (path: string) => {
    deleted.push(path);
  }),
  EncodingType: { UTF8: "utf8" },
}));

const createStandaloneMediaLocal = vi.fn(async () => "media-1");
const deleteMediaLocal = vi.fn(async () => {});
vi.mock("../sync/mediaUpload", () => ({
  createStandaloneMediaLocal: (...args: unknown[]) =>
    createStandaloneMediaLocal(...(args as [])),
  deleteMediaLocal: (...args: unknown[]) => deleteMediaLocal(...(args as [])),
}));

const getMediaById = vi.fn(async () => ({ id: "media-0" }));
vi.mock("../sync/mirrorStore", () => ({
  getMediaById: (...args: unknown[]) => getMediaById(...(args as [])),
}));

const updateTrack = vi.fn(async () => {});
vi.mock("./tracksDb", () => ({
  updateTrack: (...args: unknown[]) => updateTrack(...(args as [])),
  getTrack: vi.fn(async () => null),
  listTrackPoints: vi.fn(async () => []),
}));

const { backUpFinishedTrack, trackBackupMetadata, TrackBackupError } = await import(
  "./trackBackup"
);
type Track = Parameters<typeof backUpFinishedTrack>[0];

const STARTED = "2026-09-01T00:00:00.000Z";
const ENDED = "2026-09-01T02:00:00.000Z";

function finishedTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "track-1",
    name: "Track 1/9/2026",
    state: "done",
    color: "#f59e0b",
    visible: true,
    currentSegment: 0,
    distanceM: 4200.5,
    durationMs: 7_200_000,
    elevationGainM: 310,
    elevationLossM: 295,
    pointCount: 2,
    startedAt: STARTED,
    endedAt: ENDED,
    pausedMs: 0,
    pausedAt: null,
    mediaId: null,
    updatedAt: ENDED,
    ...overrides,
  };
}

function points(): RecordedTrackPoint[] {
  return [
    {
      segment: 0,
      lon: 150.4,
      lat: -33.56,
      altitudeM: 500,
      accuracyM: 5,
      timestampMs: Date.parse(STARTED),
    },
    {
      segment: 0,
      lon: 150.41,
      lat: -33.57,
      altitudeM: 540,
      accuracyM: 5,
      timestampMs: Date.parse(ENDED),
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  written.length = 0;
  deleted.length = 0;
  createStandaloneMediaLocal.mockResolvedValue("media-1");
});

describe("the stats a backed-up recording carries", () => {
  it("takes them from the recorder, and the extent from the points", () => {
    expect(trackBackupMetadata(finishedTrack(), points())).toEqual({
      bbox: [150.4, -33.57, 150.41, -33.56],
      distanceM: 4200.5,
      durationMs: 7_200_000,
      elevationGainM: 310,
      elevationLossM: 295,
      pointCount: 2,
      startedAt: STARTED,
      endedAt: ENDED,
    });
  });

  // Every field is required server-side and a negative one is a 400, which
  // would park the media op in the outbox with nothing naming the cause.
  it("refuses a number the API would reject, at the finish tap", () => {
    expect(() =>
      trackBackupMetadata(finishedTrack({ distanceM: -1 }), points()),
    ).toThrow(/distanceM/);
  });

  it("refuses a recording with no extent and one that has not finished", () => {
    expect(() => trackBackupMetadata(finishedTrack(), [])).toThrow(/extent/);
    expect(() => trackBackupMetadata(finishedTrack({ endedAt: null }), points())).toThrow(
      /finished/,
    );
  });
});

describe("backing a finished recording up", () => {
  it("writes the GPX into the declared store and registers it as a track file", async () => {
    await expect(backUpFinishedTrack(finishedTrack(), points())).resolves.toBe(
      "media-1",
    );

    expect(written).toHaveLength(1);
    expect(written[0]!.path.startsWith(STORE)).toBe(true);
    expect(written[0]!.content).toContain("<trkpt");
    const [args] = createStandaloneMediaLocal.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(args).toMatchObject({
      origin: "track",
      mediaType: "application/gpx+xml",
      filePath: written[0]!.path,
      displayName: "Track 1/9/2026",
      color: "#f59e0b",
    });
    // The join between the recorder's own row and the copy that syncs.
    expect(updateTrack).toHaveBeenCalledWith("track-1", { mediaId: "media-1" });
  });

  it("does nothing at all for a recording that accepted no fixes", async () => {
    await expect(backUpFinishedTrack(finishedTrack(), [])).resolves.toBeNull();
    expect(written).toEqual([]);
    expect(createStandaloneMediaLocal).not.toHaveBeenCalled();
    expect(updateTrack).not.toHaveBeenCalled();
  });

  // continueTrackRecording un-finishes a track and the second finish covers the
  // whole trip; the file from the first one is now half of it.
  it("supersedes the file a previous finish produced", async () => {
    createStandaloneMediaLocal.mockResolvedValue("media-2");

    await backUpFinishedTrack(finishedTrack({ mediaId: "media-0" }), points());

    // Created BEFORE the old one goes, so a failure can never leave no copy.
    expect(createStandaloneMediaLocal).toHaveBeenCalledTimes(1);
    expect(deleteMediaLocal).toHaveBeenCalledWith({ id: "media-0" });
    expect(updateTrack).toHaveBeenCalledWith("track-1", { mediaId: "media-2" });
  });
});

// The rule this file exists for: someone who has just walked a canyon must not
// lose their track because an upload could not be queued.
describe("a failure leaves the recording alone", () => {
  it("keeps the track row untouched and deletes the orphaned GPX", async () => {
    createStandaloneMediaLocal.mockRejectedValue(new Error("no store"));

    await expect(backUpFinishedTrack(finishedTrack(), points())).rejects.toBeInstanceOf(
      TrackBackupError,
    );

    expect(updateTrack).not.toHaveBeenCalled();
    expect(deleted).toEqual([written[0]!.path]);
  });

  it("keeps the GPX once a media row owns it", async () => {
    // Past registration the file is a queued upload's body: deleting it would
    // turn a retryable failure into a row that can never be sent.
    updateTrack.mockRejectedValueOnce(new Error("db is gone"));

    await expect(backUpFinishedTrack(finishedTrack(), points())).rejects.toBeInstanceOf(
      TrackBackupError,
    );

    expect(deleted).toEqual([]);
  });

  it("carries the cause rather than swallowing it", async () => {
    const cause = new Error("disk full");
    createStandaloneMediaLocal.mockRejectedValue(cause);

    await expect(backUpFinishedTrack(finishedTrack(), points())).rejects.toMatchObject({
      cause,
    });
  });
});
