// The elevation chart's x axis has to agree with the distance printed above it.
//
// A DEM profile measures the line it was sampled along, built from RAW fix
// positions; the headline distance walks position-smoothed ones, because
// summing raw fix-to-fix hops integrates the error circle as travel. On a real
// 3.4 km walk that gap was 14%, and the chart ran to 4.0 km beside a stat card
// reading 3.4 — which reads as one of them being broken.
import { describe, expect, it } from "vitest";
import { CLIMB_SOURCES } from "./demSources.js";
import type { ElevationProfile } from "./elevation.js";
import type { TrackDetail } from "./trackStats.js";

import {
  elevationSeries,
  sameSeries,
  storedClimbCaption,
  speedSeries,
  timeOfDayFormatter,
  trackHeights,
  trackStatRows,
} from "./profileSeries.js";

const profile: ElevationProfile = {
  samples: [
    { distanceM: 0, elevationM: 10 },
    { distanceM: 2000, elevationM: 40 },
    { distanceM: 4000, elevationM: 20 },
  ],
  gainM: 30,
  lossM: 20,
  minM: 10,
  maxM: 40,
};

describe("elevationSeries", () => {
  it("ends at the distance the rest of the panel reports", () => {
    const series = elevationSeries(profile, 3400);
    expect(series.points[series.points.length - 1]!.x).toBe(3400);
    expect(series.points[0]!.x).toBe(0);
  });

  it("scales uniformly, so every feature stays where it was along the track", () => {
    const series = elevationSeries(profile, 3400);
    // The midpoint sample was halfway along; it still is.
    expect(series.points[1]!.x).toBe(1700);
    // Heights are untouched — only the axis was wrong.
    expect(series.points.map((p) => p.value)).toEqual([10, 40, 20]);
    expect(series.min).toBe(10);
    expect(series.max).toBe(40);
  });

  it("leaves the profile's own axis alone when given no distance", () => {
    // Routes have no measured-distance counterpart to reconcile with.
    expect(elevationSeries(profile).points[2]!.x).toBe(4000);
  });

  it("does not divide by zero on a degenerate profile", () => {
    const flat: ElevationProfile = {
      ...profile,
      samples: [{ distanceM: 0, elevationM: 5 }],
    };
    expect(elevationSeries(flat, 3400).points[0]!.x).toBe(0);
  });
});

// Red when the day is dropped from an overnight series, or added to a
// same-day one.
describe("timeOfDayFormatter", () => {
  // Local-time constructors, so the test holds in any time zone.
  const evening = new Date(2026, 5, 3, 23, 50).getTime();
  const nextEvening = new Date(2026, 5, 4, 23, 50).getTime();
  const afterMidnight = new Date(2026, 5, 4, 0, 10).getTime();

  it("is the bare time of day when the series stays within one day", () => {
    const format = timeOfDayFormatter(evening - 3_600_000, evening);
    expect(format(evening)).toBe(format(nextEvening));
    expect(format(evening)).not.toBe(format(evening + 60_000));
  });

  it("names the day when the series crosses midnight", () => {
    const format = timeOfDayFormatter(evening, afterMidnight);
    expect(format(evening)).not.toBe(format(nextEvening));
  });
});

// Red when a tick that changed nothing is read as new data (the chart then
// rebuilds its columns every second of a recording), or when a real change —
// a new fix, a moved axis — is read as the same picture.
describe("sameSeries", () => {
  it("is true for a rebuilt series with no new point", () => {
    // What a clock tick does: a fresh profile object holding the same numbers.
    const tick = {
      ...profile,
      samples: profile.samples.map((s) => ({ ...s })),
    };
    expect(
      sameSeries(elevationSeries(profile, 3400), elevationSeries(tick, 3400)),
    ).toBe(true);
  });

  it("is false when a point is added, a value moves or the axis scales", () => {
    const base = elevationSeries(profile, 3400);
    const grown = {
      ...profile,
      samples: [...profile.samples, { distanceM: 4100, elevationM: 25 }],
    };
    expect(sameSeries(base, elevationSeries(grown, 3400))).toBe(false);
    const moved = {
      ...profile,
      samples: profile.samples.map((s, i) =>
        i === 1 ? { ...s, elevationM: 41 } : s,
      ),
    };
    expect(sameSeries(base, elevationSeries(moved, 3400))).toBe(false);
    expect(sameSeries(base, elevationSeries(profile, 3500))).toBe(false);
  });

  it("sees the speed tail grow while the party stands still", () => {
    const speed = (endMs: number) =>
      speedSeries({
        samples: [
          { atMs: 0, speedMps: 1 },
          { atMs: endMs, speedMps: 0 },
        ],
        clock: [{ atMs: 0, timestampMs: 0 }],
        maxMps: 1,
        averageMps: 0.5,
      });
    expect(sameSeries(speed(1000), speed(1000))).toBe(true);
    expect(sameSeries(speed(1000), speed(2000))).toBe(false);
  });
});

describe("trackHeights", () => {
  const gps: ElevationProfile = { ...profile, minM: 12, maxM: 38 };
  const detail = {
    elevation: gps,
    maxAltitudeM: 38,
    minAltitudeM: 12,
  } as TrackDetail;

  it("charts the terrain when it answered the whole line", () => {
    const heights = trackHeights(detail, profile, false);
    expect(heights.elevation).toBe(profile);
    expect(heights.dem).toBe(profile);
    expect(heights.note).toBe("Heights from terrain data");
  });

  it("falls back to GPS for the whole panel when one sample is uncovered", () => {
    const holed: ElevationProfile = {
      ...profile,
      samples: [
        profile.samples[0]!,
        { distanceM: 2000, elevationM: null },
        profile.samples[2]!,
      ],
    };
    const heights = trackHeights(detail, holed, false);
    expect(heights.elevation).toBe(gps);
    expect(heights.dem).toBeNull();
    expect(heights.note).toBe("Terrain data incomplete — heights from GPS");
  });

  it("says GPS is a stand-in while the terrain loads, and when it never comes", () => {
    expect(trackHeights(detail, null, true).note).toBe(
      "Heights from GPS — loading terrain…",
    );
    expect(trackHeights(detail, null, false).note).toBe(
      "Heights from GPS — no terrain data here",
    );
  });

  it("says why there is no chart when neither source has a line", () => {
    const bare = { ...detail, elevation: null } as TrackDetail;
    expect(trackHeights(bare, null, true)).toMatchObject({
      elevation: null,
      note: "Reading the terrain…",
    });
    expect(trackHeights(bare, null, false).note).toBe(
      "Not enough height readings to chart",
    );
    expect(
      trackHeights({ ...bare, maxAltitudeM: null }, null, false).note,
    ).toBe("No heights for this track");
  });
});

describe("trackStatRows", () => {
  const timed = {
    distanceM: 3400,
    durationMs: 3_600_000,
    movingMs: 3_000_000,
    stoppedMs: 600_000,
    averageSpeedMps: 1,
    movingSpeedMps: 1.2,
    elevationGainM: 26,
    elevationLossM: 0,
    maxAltitudeM: 38,
    minAltitudeM: 12,
    elevation: { ...profile, minM: 12, maxM: 38 },
  } as TrackDetail;
  const labels = (detail: TrackDetail, dem: ElevationProfile | null = null) =>
    trackStatRows(detail, trackHeights(detail, dem, false)).map(
      (row) => row.label,
    );

  it("lists a timed track's figures in the panel's order", () => {
    expect(labels(timed)).toEqual([
      "Time",
      "Distance",
      "Moving",
      "Stopped",
      "Ascent",
      "Descent",
      "Avg speed",
      "Avg moving speed",
      "High point",
      "Low point",
    ]);
  });

  it("lists no clock figure for a track without times", () => {
    const untimed = {
      ...timed,
      movingMs: null,
      stoppedMs: null,
      averageSpeedMps: null,
      movingSpeedMps: null,
    } as TrackDetail;
    expect(labels(untimed)).toEqual([
      "Distance",
      "Ascent",
      "Descent",
      "High point",
      "Low point",
    ]);
  });

  it("takes every height from the terrain when the chart does", () => {
    const rows = trackStatRows(timed, trackHeights(timed, profile, false));
    const value = (label: string) =>
      rows.find((row) => row.label === label)?.value;
    expect(value("Ascent")).toBe("↑ 30 m");
    expect(value("Descent")).toBe("↓ 20 m");
    expect(value("High point")).toBe("40 m");
    expect(value("Low point")).toBe("10 m");
  });

  it("lists no height band for a track with nothing to chart", () => {
    // A lone altitude reading sets a min and a max and cannot be drawn.
    expect(labels({ ...timed, elevation: null })).not.toContain("High point");
  });
});

describe("storedClimbCaption", () => {
  // Mutation: delete an entry of HEIGHT_SOURCE_NAMES.
  it("names every source a climb can be stored from", () => {
    const captions = CLIMB_SOURCES.map(storedClimbCaption);
    expect(new Set(captions).size).toBe(CLIMB_SOURCES.length);
    for (const caption of captions) {
      expect(caption).not.toBe("Ascent and descent from terrain data");
    }
  });

  it("takes a climb with no source beside it as GPS", () => {
    expect(storedClimbCaption(undefined)).toBe(
      "Ascent and descent from GPS heights",
    );
  });

  it("names the chart's source in the same words when one source answered", () => {
    const detail = { elevation: profile, maxAltitudeM: 40 } as TrackDetail;
    const fine = { ...profile, demSourceIds: ["nsw-5m"] };
    expect(trackHeights(detail, fine, false).note).toBe(
      "Heights from NSW 5 m terrain data",
    );
    expect(storedClimbCaption("nsw-5m")).toBe(
      "Ascent and descent from NSW 5 m terrain data",
    );
    const mixed = { ...profile, demSourceIds: ["nsw-5m", "terrarium"] };
    expect(trackHeights(detail, mixed, false).note).toBe(
      "Heights from terrain data",
    );
  });

  // Mutation: look the chart's name up by the source id itself, and a line
  // read inside a sharpened area (`lidar-<job id>`) is "terrain data" while
  // its stored climb says "LiDAR terrain data".
  it("names a sharpened area's heights as its stored climb does", () => {
    const detail = { elevation: profile, maxAltitudeM: 40 } as TrackDetail;
    for (const demSourceIds of [["lidar-x"], ["lidar-x", "lidar-y"]])
      expect(
        trackHeights(detail, { ...profile, demSourceIds }, false).note,
        demSourceIds.join(),
      ).toBe("Heights from LiDAR terrain data");
    expect(storedClimbCaption("lidar")).toBe(
      "Ascent and descent from LiDAR terrain data",
    );
  });
});
