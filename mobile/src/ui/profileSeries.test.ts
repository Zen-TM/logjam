// The elevation chart's x axis has to agree with the distance printed above it.
//
// A DEM profile measures the line it was sampled along, built from RAW fix
// positions; the headline distance walks position-smoothed ones, because
// summing raw fix-to-fix hops integrates the error circle as travel. On a real
// 3.4 km walk that gap was 14%, and the chart ran to 4.0 km beside a stat card
// reading 3.4 — which reads as one of them being broken.
import { describe, expect, it } from "vitest";
import type { ElevationProfile } from "@logjam/shared";

import { elevationSeries, timeOfDayFormatter } from "./profileSeries";

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
