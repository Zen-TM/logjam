// The elevation chart's x axis has to agree with the distance printed above it.
//
// A DEM profile measures the line it was sampled along, built from RAW fix
// positions; the headline distance walks position-smoothed ones, because
// summing raw fix-to-fix hops integrates the error circle as travel. On a real
// 3.4 km walk that gap was 14%, and the chart ran to 4.0 km beside a stat card
// reading 3.4 — which reads as one of them being broken.
import { describe, expect, it } from "vitest";
import type { ElevationProfile } from "@logjam/shared";

import {
  elevationSeries,
  sameSeries,
  speedSeries,
  timeOfDayFormatter,
} from "./profileSeries";

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
