// "Log a trip" copies a recording into the trip; the copy names the recording
// (its account media id) so the recording stops offering it. Everything the
// modules reach for is mocked: what is under test is which id is passed on.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** The track row as the database holds it now. */
  stored: { id: "t1", mediaId: "media-1" as string | null },
}));
const attachMediaLocal = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => "copy-1"),
);

vi.mock("expo-file-system/legacy", () => ({
  writeAsStringAsync: async () => {},
  deleteAsync: async () => {},
}));
vi.mock("../offline/localStores", () => ({
  scratchFileUri: async (name: string) => `file:///scratch/${name}`,
}));
vi.mock("../sync/mediaUpload", () => ({ attachMediaLocal }));
vi.mock("../sync/mediaCache", () => ({
  ensureDisplayCached: async () => "file:///cache/m9.display",
}));
vi.mock("./tracksDb", () => ({
  getTrack: async () => state.stored,
  listTrackPoints: async () => [
    { lat: -33.5, lon: 150.4, altitudeM: null, timestampMs: 1_000, segment: 0 },
    {
      lat: -33.6,
      lon: 150.5,
      altitudeM: null,
      timestampMs: 61_000,
      segment: 0,
    },
  ],
}));

const { attachRecordedTrack } = await import("./attachRecordedTrack");
const { syncedTrackSource } = await import("./tripTrackSource");

beforeEach(() => {
  attachMediaLocal.mockClear();
  state.stored = { id: "t1", mediaId: "media-1" };
});

describe("the copy a trip keeps of a recording", () => {
  // Mutation: read `track.mediaId` from the argument instead of the stored row
  // and a track object captured before the backup passes null.
  it("names the recording's account copy, read when the copy is made", async () => {
    await attachRecordedTrack("tripLog", "trip-1", { id: "t1", name: "Creek" });
    expect(attachMediaLocal).toHaveBeenCalledWith(
      "tripLog",
      "trip-1",
      expect.objectContaining({ fileName: "Creek.gpx" }),
      "media-1",
    );
  });

  it("names nothing for a recording that is not backed up yet", async () => {
    state.stored = { id: "t1", mediaId: null };
    await attachRecordedTrack("tripLog", "trip-1", { id: "t1", name: "Creek" });
    expect(attachMediaLocal.mock.calls[0][3]).toBeUndefined();
  });

  // Mutation: drop the `linkedType === "tripLog"` test, and a recording
  // attached to a place would send a source the API refuses.
  it("names nothing on a place", async () => {
    await attachRecordedTrack("place", "place-1", { id: "t1", name: "Creek" });
    expect(attachMediaLocal.mock.calls[0][3]).toBeUndefined();
  });

  it("names a recording made elsewhere by its own media id", async () => {
    const source = syncedTrackSource({
      id: "m9",
      filename: "Creek.gpx",
      mediaType: "application/gpx+xml",
      metadata: {},
      localDisplayPath: null,
      title: "Creek",
    });
    await source.attach("trip-2");
    expect(attachMediaLocal.mock.calls[0][3]).toBe("m9");
  });
});
