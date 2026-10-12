import { describe, it, expect } from "vitest";

import {
  MediaMetadataError,
  parseMediaMetadata,
  parseTrackClimb,
  readMediaMetadata,
} from "./mediaMetadata";

const IMPORT = {
  bbox: [150, -34, 150.5, -33.5],
  featureCount: 2,
  positionCount: 400,
};
const TRACK = {
  bbox: [150, -34, 150.5, -33.5],
  distanceM: 4200,
  durationMs: 7_200_000,
  elevationGainM: 310,
  elevationLossM: 290,
  pointCount: 5400,
  startedAt: "2026-09-01T00:10:00.000Z",
  endedAt: "2026-09-01T02:10:00.000Z",
};

describe("parseMediaMetadata", () => {
  it("round-trips an import", () => {
    expect(parseMediaMetadata("import", IMPORT)).toEqual(IMPORT);
  });

  it("round-trips a track", () => {
    expect(parseMediaMetadata("track", TRACK)).toEqual(TRACK);
  });

  it("keeps the source a track's climb was read from", () => {
    const track = { ...TRACK, elevationSource: "nsw-5m" };
    expect(parseMediaMetadata("track", track)).toEqual(track);
  });

  it("reads a climb source it does not know as none, which means GPS", () => {
    // A row from a newer build must still be accepted by an older API.
    const parsed = parseMediaMetadata("track", {
      ...TRACK,
      elevationSource: "nsw-1m",
    });
    expect(parsed).toEqual(TRACK);
  });

  it("drops unknown keys rather than rejecting the write", () => {
    const parsed = parseMediaMetadata("import", { ...IMPORT, futureField: 1 });
    expect(parsed).not.toHaveProperty("futureField");
    expect(parsed).toEqual(IMPORT);
  });

  it("stores nothing for a place/trip attachment", () => {
    expect(parseMediaMetadata(null, TRACK)).toEqual({});
  });

  it("rejects a missing stat instead of defaulting it to zero", () => {
    const { distanceM: _omitted, ...rest } = TRACK;
    expect(() => parseMediaMetadata("track", rest)).toThrow(MediaMetadataError);
  });

  it("rejects a negative magnitude", () => {
    expect(() =>
      parseMediaMetadata("track", { ...TRACK, elevationLossM: -1 }),
    ).toThrow(MediaMetadataError);
  });

  it("rejects out-of-range and malformed bounds", () => {
    expect(() =>
      parseMediaMetadata("import", { ...IMPORT, bbox: [150, -34, 150.5] }),
    ).toThrow(MediaMetadataError);
    expect(() =>
      parseMediaMetadata("import", { ...IMPORT, bbox: [150, -34, 181, -33.5] }),
    ).toThrow(MediaMetadataError);
    expect(() =>
      parseMediaMetadata("import", { ...IMPORT, bbox: [150, -34, 150.5, -99] }),
    ).toThrow(MediaMetadataError);
    // south > north — a swapped pair, which would fly a camera to the wrong place.
    expect(() =>
      parseMediaMetadata("import", { ...IMPORT, bbox: [150, -33, 150.5, -34] }),
    ).toThrow(MediaMetadataError);
    expect(() =>
      parseMediaMetadata("import", {
        ...IMPORT,
        bbox: [150, Number.NaN, 150.5, -33.5],
      }),
    ).toThrow(MediaMetadataError);
  });

  it("rejects a non-ISO timestamp", () => {
    expect(() =>
      parseMediaMetadata("track", { ...TRACK, endedAt: "yesterday" }),
    ).toThrow(MediaMetadataError);
  });

  it("accepts an antimeridian-crossing extent (west > east is legal)", () => {
    const crossing = { ...IMPORT, bbox: [179, -34, -179, -33.5] };
    expect(parseMediaMetadata("import", crossing)).toEqual(crossing);
  });
});

describe("readMediaMetadata", () => {
  it("never throws on a bad row — the list still renders", () => {
    expect(readMediaMetadata("track", { distanceM: "far" })).toEqual({});
    expect(readMediaMetadata("import", null)).toEqual({});
    expect(readMediaMetadata(null, TRACK)).toEqual({});
    expect(readMediaMetadata("nonsense", TRACK)).toEqual({});
  });

  it("returns the stats when the row is good", () => {
    expect(readMediaMetadata("track", TRACK)).toEqual(TRACK);
  });
});

describe("parseTrackClimb", () => {
  const CLIMB = {
    elevationGainM: 412,
    elevationLossM: 398,
    elevationSource: "nsw-5m",
  };

  it("returns the two figures and their source, and nothing else", () => {
    expect(parseTrackClimb({ ...CLIMB, distanceM: 1 })).toEqual(CLIMB);
  });

  it("refuses figures without a known source", () => {
    const { elevationSource: _source, ...figures } = CLIMB;
    expect(() => parseTrackClimb(figures)).toThrow(MediaMetadataError);
    expect(() =>
      parseTrackClimb({ ...CLIMB, elevationSource: "barometer" }),
    ).toThrow(MediaMetadataError);
  });

  it("refuses a source without both figures", () => {
    expect(() =>
      parseTrackClimb({ elevationGainM: 1, elevationSource: "gps" }),
    ).toThrow(MediaMetadataError);
    expect(() => parseTrackClimb({ ...CLIMB, elevationLossM: -1 })).toThrow(
      MediaMetadataError,
    );
  });
});
