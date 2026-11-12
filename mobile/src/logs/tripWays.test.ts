// A trip keeps a way as a copy of a file. What is under test is which file, and
// whose id it names; everything the modules reach for is mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const attachMediaLocal = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => "copy-1"),
);
const attachRecordedTrack = vi.hoisted(() => vi.fn(async () => true));
const written = vi.hoisted(() => ({ text: "", deleted: [] as string[] }));
const sendCopy = vi.hoisted(() => ({
  current: undefined as
    | undefined
    | {
        filename: string;
        resolveFile: () => Promise<{
          uri: string;
          cleanup?: () => Promise<void>;
        }>;
      },
}));

vi.mock("expo-file-system/legacy", () => ({
  writeAsStringAsync: async (_uri: string, text: string) => {
    written.text = text;
  },
  deleteAsync: async (uri: string) => {
    written.deleted.push(uri);
  },
}));
vi.mock("../offline/localStores", () => ({
  scratchFileUri: async (name: string) => `file:///scratch/${name}`,
}));
vi.mock("../sync/mediaUpload", () => ({ attachMediaLocal }));
vi.mock("../tracks/attachRecordedTrack", () => ({ attachRecordedTrack }));
vi.mock("../saved/assetActions", () => ({
  vectorImportActions: () => ({ sendCopy: sendCopy.current }),
}));

const { queueStagedMedia } = await import("../places/stagedPlaceMedia");
const {
  trackSourceWay,
  tripFileWay,
  tripImportWay,
  tripRecordingWay,
  tripRouteWay,
} = await import("./tripWays");

beforeEach(() => {
  attachMediaLocal.mockClear();
  attachRecordedTrack.mockClear();
  attachRecordedTrack.mockResolvedValue(true);
  written.text = "";
  written.deleted = [];
  sendCopy.current = undefined;
});

describe("the ways a trip takes", () => {
  it("writes a drawn route out as a GPX copy and clears the scratch file", async () => {
    await tripRouteWay({
      id: "r1",
      name: "Creek line",
      points: [
        [150.1, -33.1],
        [150.2, -33.2],
      ],
    })("trip-1");

    expect(written.text).toContain("<rtept");
    expect(attachMediaLocal).toHaveBeenCalledWith(
      "tripLog",
      "trip-1",
      expect.objectContaining({
        mimeType: "application/gpx+xml",
        fileName: "Creek line.gpx",
      }),
    );
    expect(written.deleted).toEqual(["file:///scratch/r1.gpx"]);
  });

  // Mutation: let a recording with too few points resolve, and the form says
  // "Trip logged." with no track on it.
  it("refuses a recording that is too short to be a line", async () => {
    attachRecordedTrack.mockResolvedValue(false);
    await expect(
      tripRecordingWay({ id: "t1", name: "Walk" })("trip-1"),
    ).rejects.toThrow();
    expect(attachRecordedTrack).toHaveBeenCalledWith("tripLog", "trip-1", {
      id: "t1",
      name: "Walk",
    });
  });

  it("copies a picked file onto the trip as it is", async () => {
    await tripFileWay({ uri: "file:///cache/a.gpx", fileName: "a.gpx" })(
      "trip-1",
    );
    expect(attachMediaLocal).toHaveBeenCalledWith("tripLog", "trip-1", {
      uri: "file:///cache/a.gpx",
      fileName: "a.gpx",
    });
  });

  // Mutation: offer an import whose original is GeoJSON or not on this phone,
  // and the row can only fail.
  it("offers an import only while its original .gpx or .kml is on this phone", () => {
    const row = {} as never;
    expect(tripImportWay(row)).toBeNull();
    sendCopy.current = {
      filename: "ridge.geojson",
      resolveFile: async () => ({ uri: "file:///x" }),
    };
    expect(tripImportWay(row)).toBeNull();
    sendCopy.current = {
      filename: "ridge.kml",
      resolveFile: async () => ({ uri: "file:///x" }),
    };
    expect(tripImportWay(row)).not.toBeNull();
  });

  it("copies an import's original with the route-file type", async () => {
    const cleanup = vi.fn(async () => {});
    sendCopy.current = {
      filename: "ridge.kml",
      resolveFile: async () => ({ uri: "file:///orig", cleanup }),
    };
    await tripImportWay({} as never)!("trip-1");
    expect(attachMediaLocal).toHaveBeenCalledWith("tripLog", "trip-1", {
      uri: "file:///orig",
      mimeType: "application/vnd.google-earth.kml+xml",
      fileName: "ridge.kml",
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

describe("logging a trip from a track", () => {
  const source = (attach: (tripId: string) => Promise<boolean>) => ({
    name: "Creek",
    startedAt: null,
    needsConnection: false,
    attach,
  });

  // Mutation: stage the track without calling its `attach` and the trip saves
  // with no track and the track keeps offering "Log a trip".
  it("attaches the track to the new trip when the staged way is queued", async () => {
    const attach = vi.fn(async () => true);
    const way = trackSourceWay(source(attach));

    const result = await queueStagedMedia(
      "trip-1",
      { files: [], way },
      vi.fn(),
    );

    expect(way.label).toBe("Creek");
    expect(attach).toHaveBeenCalledExactlyOnceWith("trip-1");
    expect(result).toEqual({ failed: false });
  });

  it("says the trip was logged without its track when the track will not attach", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await queueStagedMedia(
      "trip-1",
      { files: [], way: trackSourceWay(source(async () => false)) },
      vi.fn(),
    );
    expect(result).toEqual({ failed: true });
  });
});
