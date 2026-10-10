import { describe, expect, it } from "vitest";
import { tripPrefillFromTrack } from "./trackTrip.js";

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
