import { describe, expect, it } from "vitest";
import {
  gpxEnds,
  placesNearTrackEnds,
  recordingsToLog,
  tripPrefillFromTrack,
} from "./trackTrip.js";

describe("tripPrefillFromTrack", () => {
  // 20:30 UTC on the 14th is 07:30 on the 15th in Sydney (AEDT, UTC+11): the
  // UTC date is the day before the one the user walked.
  const startedAt = "2026-03-14T20:30:00.000Z";

  it("files a trip under the track's local day, across a UTC day boundary", () => {
    expect(startedAt.slice(0, 10)).toBe("2026-03-14");
    expect(tripPrefillFromTrack({ startedAt }, "Australia/Sydney").date).toBe(
      "2026-03-15",
    );
    expect(tripPrefillFromTrack({ startedAt }, "UTC").date).toBe("2026-03-14");
  });

  it("uses the device's own day when no zone is given", () => {
    const local = new Date(startedAt);
    const key = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
    expect(tripPrefillFromTrack({ startedAt }).date).toBe(key);
  });

  it("carries the place a track is on, and none where it is on none", () => {
    expect(tripPrefillFromTrack({ startedAt, placeId: "p1" }).placeIds).toEqual(
      ["p1"],
    );
    expect(tripPrefillFromTrack({ startedAt, placeId: null }).placeIds).toEqual(
      [],
    );
    expect(tripPrefillFromTrack({ startedAt }).placeIds).toEqual([]);
  });

  it("falls back to today for a track with no readable start", () => {
    for (const bad of [null, "", "not a date"]) {
      expect(tripPrefillFromTrack({ startedAt: bad }).date).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
    }
  });
});

describe("recordingsToLog", () => {
  // Wall-clock noon on 15 Mar, in whatever zone the runner has.
  const today = new Date(2026, 2, 15, 12);
  const at = (day: number, hour = 9) =>
    new Date(2026, 2, day, hour).toISOString();
  const track = (id: string, startedAt: string | null) => ({ id, startedAt });
  const trip = (day: number) => ({
    date: `2026-03-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  });

  it("offers a recent recording whose day has no trip, newest first", () => {
    const tracks = [
      track("old", at(3)),
      track("new", at(14)),
      track("mid", at(9)),
    ];
    expect(recordingsToLog(tracks, [trip(9)], today).map((t) => t.id)).toEqual([
      "new",
      "old",
    ]);
  });

  it("matches the trip to the track's LOCAL day, not its UTC day", () => {
    // Mutation: compare the track's UTC date (startedAt.slice(0, 10)) and this
    // 07:30 AEDT walk, which began on the 14th in UTC, is logged by a trip on
    // the 14th instead of the 15th.
    const startedAt = "2026-03-14T20:30:00.000Z";
    const sydneyToday = new Date("2026-03-15T02:00:00.000Z");
    const tracks = [track("walk", startedAt)];
    expect(
      recordingsToLog(tracks, [trip(15)], sydneyToday, "Australia/Sydney"),
    ).toEqual([]);
    expect(
      recordingsToLog(tracks, [trip(14)], sydneyToday, "Australia/Sydney"),
    ).toHaveLength(1);
  });

  it("drops recordings older than 30 days, in the future, or undated", () => {
    const tracks = [
      track("stale", new Date(2026, 1, 10, 9).toISOString()),
      track("edge", new Date(2026, 1, 13, 9).toISOString()),
      track("future", at(20)),
      track("none", null),
      track("junk", "not a date"),
    ];
    expect(recordingsToLog(tracks, [], today).map((t) => t.id)).toEqual([
      "edge",
    ]);
  });
});

describe("placesNearTrackEnds", () => {
  const place = (id: string, latitude: number, longitude: number) => ({
    id,
    latitude,
    longitude,
  });
  const start = { latitude: -33.6, longitude: 150.3 };
  const end = { latitude: -33.65, longitude: 150.35 };

  it("offers places near either end, nearest first, and none far off", () => {
    const places = [
      place("far", -34, 151),
      place("atEnd", -33.6501, 150.3501),
      place("atStart", -33.6, 150.3),
      place("near", -33.605, 150.3),
    ];
    expect(placesNearTrackEnds([start, end], places)).toEqual([
      "atStart",
      "atEnd",
      "near",
    ]);
  });

  it("flows through tripPrefillFromTrack without linking them, minus the track's own place", () => {
    const places = [place("p1", -33.6, 150.3), place("p2", -33.6001, 150.3)];
    const prefill = tripPrefillFromTrack(
      { startedAt: null, placeId: "p1", ends: [start] },
      undefined,
      places,
    );
    expect(prefill.placeIds).toEqual(["p1"]);
    expect(prefill.nearPlaceIds).toEqual(["p2"]);
    expect(tripPrefillFromTrack({ startedAt: null }).nearPlaceIds).toEqual([]);
  });
});

describe("gpxEnds", () => {
  it("reads the first and last point, and nothing from a GPX with none", () => {
    const gpx = `<gpx><trk><trkseg>
      <trkpt lat="-33.1" lon="150.2"><ele>1</ele></trkpt>
      <trkpt lat="-33.2" lon="150.3"></trkpt>
      <trkpt lat="-33.3" lon="150.4"/>
    </trkseg></trk></gpx>`;
    expect(gpxEnds(gpx)).toEqual([
      { latitude: -33.1, longitude: 150.2 },
      { latitude: -33.3, longitude: 150.4 },
    ]);
    expect(gpxEnds("<gpx/>")).toEqual([]);
  });
});
