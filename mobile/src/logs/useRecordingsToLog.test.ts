// Which recordings the Logs hero counts: recorded here or synced, listed once,
// with a line to attach, on a day with no trip.
import { describe, expect, it, vi } from "vitest";

import { recordingsToLogFrom } from "./useRecordingsToLog";

vi.mock("@react-navigation/native", () => ({ useFocusEffect: () => {} }));
vi.mock("../tracks/useRemoteTracks", () => ({
  useStandaloneTrackMedia: () => [],
}));
vi.mock("../tracks/tracksDb", () => ({ listTracks: async () => [] }));
vi.mock("../tracks/tripTrackSource", () => ({
  recordedTrackSource: (track: { name: string; startedAt: string }) => ({
    name: track.name,
    startedAt: track.startedAt,
  }),
  syncedTrackSource: (file: {
    title: string;
    metadata: { startedAt: string };
  }) => ({
    name: file.title,
    startedAt: file.metadata.startedAt,
  }),
}));

const today = new Date(2026, 2, 15, 12);
const at = (day: number) => new Date(2026, 2, day, 9).toISOString();
const track = (id: string, day: number, over: object = {}) =>
  ({
    id,
    name: id,
    state: "done",
    pointCount: 10,
    mediaId: null,
    startedAt: at(day),
    ...over,
  }) as never;
const file = (id: string, day: number) =>
  ({
    id,
    filename: `${id}.gpx`,
    displayName: id,
    metadata: { startedAt: at(day) },
  }) as never;
const trip = (day: number) => ({
  date: `2026-03-${String(day).padStart(2, "0")}T00:00:00.000Z`,
});
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("recordingsToLogFrom", () => {
  // Mutation: drop the `localMediaIds` filter and "both" is listed twice.
  it("lists a recording once when this phone holds both halves", () => {
    const rows = recordingsToLogFrom(
      [track("both", 14, { mediaId: "m1" })],
      [file("m1", 14), file("elsewhere", 12)],
      [],
      today,
    );
    expect(names(rows)).toEqual(["both", "elsewhere"]);
  });

  // Mutation: change `pointCount >= 2` to `>= 1`, or drop the `done` check.
  it("leaves out an unfinished recording and one with nothing to attach", () => {
    const rows = recordingsToLogFrom(
      [
        track("live", 14, { state: "recording" }),
        track("one", 13, { pointCount: 1 }),
        track("ok", 12),
      ],
      [],
      [],
      today,
    );
    expect(names(rows)).toEqual(["ok"]);
  });

  it("leaves out a day that has a trip, taking the trip's stored UTC-midnight date", () => {
    const rows = recordingsToLogFrom(
      [track("logged", 14), track("open", 12)],
      [],
      [trip(14)],
      today,
    );
    expect(names(rows)).toEqual(["open"]);
  });
});
