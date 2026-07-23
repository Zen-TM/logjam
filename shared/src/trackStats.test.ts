import { describe, expect, it } from "vitest";

import {
  ELEVATION_HYSTERESIS_M,
  MAX_ACCEPTED_ACCURACY_M,
  compassPointFor,
  computeTrackStats,
  formatDistanceM,
  formatDurationMs,
  initialBearingDegrees,
  rejectTrackFix,
  type RecordedTrackPoint,
} from "./trackStats.js";

// Synthetic coords only (repo rule): 150.2–150.3 E, −33.6–−33.7 S.
const BASE_LAT = -33.65;
const BASE_LON = 150.25;

// 0.001° of latitude ≈ 111.19 m everywhere.
const LAT_STEP_M_PER_MILLIDEG = 111.19;

function point(
  overrides: Partial<RecordedTrackPoint> & { timestampMs: number },
): RecordedTrackPoint {
  return {
    lon: BASE_LON,
    lat: BASE_LAT,
    altitudeM: null,
    accuracyM: 10,
    segment: 0,
    ...overrides,
  };
}

describe("rejectTrackFix", () => {
  const prev = point({ timestampMs: 1000 });

  it("accepts a clean fix", () => {
    expect(
      rejectTrackFix(prev, point({ lat: BASE_LAT + 0.001, timestampMs: 2000 })),
    ).toBeNull();
  });

  it("accepts the first fix of a track (no prev)", () => {
    expect(rejectTrackFix(null, point({ timestampMs: 1000 }))).toBeNull();
  });

  it("rejects non-finite and out-of-range coordinates", () => {
    expect(rejectTrackFix(null, point({ lat: NaN, timestampMs: 1 }))).toBe(
      "invalid",
    );
    expect(rejectTrackFix(null, point({ lon: 181, timestampMs: 1 }))).toBe(
      "invalid",
    );
    expect(rejectTrackFix(null, point({ lat: 91, timestampMs: 1 }))).toBe(
      "invalid",
    );
  });

  it("rejects fixes above the accuracy ceiling, keeps null accuracy", () => {
    expect(
      rejectTrackFix(
        prev,
        point({
          lat: BASE_LAT + 0.001,
          accuracyM: MAX_ACCEPTED_ACCURACY_M + 1,
          timestampMs: 2000,
        }),
      ),
    ).toBe("inaccurate");
    expect(
      rejectTrackFix(
        prev,
        point({ lat: BASE_LAT + 0.001, accuracyM: null, timestampMs: 2000 }),
      ),
    ).toBeNull();
  });

  it("rejects out-of-order and duplicate timestamps", () => {
    expect(
      rejectTrackFix(prev, point({ lat: BASE_LAT + 0.001, timestampMs: 1000 })),
    ).toBe("out-of-order");
    expect(
      rejectTrackFix(prev, point({ lat: BASE_LAT + 0.001, timestampMs: 999 })),
    ).toBe("out-of-order");
  });

  it("rejects sub-threshold movement (replayed last fix)", () => {
    expect(rejectTrackFix(prev, point({ timestampMs: 2000 }))).toBe("too-close");
  });
});

describe("computeTrackStats", () => {
  it("empty and single-point tracks are zero", () => {
    expect(computeTrackStats([])).toEqual({
      distanceM: 0,
      durationMs: 0,
      elevationGainM: 0,
      elevationLossM: 0,
      pointCount: 0,
    });
    expect(computeTrackStats([point({ timestampMs: 0 })]).distanceM).toBe(0);
  });

  it("sums haversine distance along a latitude line", () => {
    // 10 steps of 0.001° lat ≈ 10 × 111.19 m.
    const points = Array.from({ length: 11 }, (_, i) =>
      point({ lat: BASE_LAT + i * 0.001, timestampMs: i * 10_000 }),
    );
    const stats = computeTrackStats(points);
    expect(stats.distanceM).toBeCloseTo(10 * LAT_STEP_M_PER_MILLIDEG, 0);
    expect(stats.durationMs).toBe(100_000);
    expect(stats.pointCount).toBe(11);
  });

  it("excludes the pause gap from distance and duration (segment break)", () => {
    const points = [
      point({ lat: BASE_LAT, timestampMs: 0, segment: 0 }),
      point({ lat: BASE_LAT + 0.001, timestampMs: 10_000, segment: 0 }),
      // 30-minute pause, user teleported 0.01° away.
      point({ lat: BASE_LAT + 0.011, timestampMs: 1_810_000, segment: 1 }),
      point({ lat: BASE_LAT + 0.012, timestampMs: 1_820_000, segment: 1 }),
    ];
    const stats = computeTrackStats(points);
    expect(stats.distanceM).toBeCloseTo(2 * LAT_STEP_M_PER_MILLIDEG, 0);
    expect(stats.durationMs).toBe(20_000);
  });

  it("altitude sawtooth below the hysteresis threshold accumulates nothing", () => {
    const jitter = ELEVATION_HYSTERESIS_M / 2;
    const points = Array.from({ length: 40 }, (_, i) =>
      point({
        lat: BASE_LAT + i * 0.001,
        altitudeM: 600 + (i % 2 === 0 ? 0 : jitter),
        timestampMs: i * 10_000,
      }),
    );
    const stats = computeTrackStats(points);
    expect(stats.elevationGainM).toBe(0);
    expect(stats.elevationLossM).toBe(0);
  });

  it("counts a real climb-then-descend once each", () => {
    // 600 → 700 in 10 m steps, then back down to 650.
    const up = Array.from({ length: 11 }, (_, i) =>
      point({
        lat: BASE_LAT + i * 0.001,
        altitudeM: 600 + i * 10,
        timestampMs: i * 10_000,
      }),
    );
    const down = Array.from({ length: 5 }, (_, i) =>
      point({
        lat: BASE_LAT + (11 + i) * 0.001,
        altitudeM: 690 - i * 10,
        timestampMs: (11 + i) * 10_000,
      }),
    );
    const stats = computeTrackStats([...up, ...down]);
    expect(stats.elevationGainM).toBe(100);
    expect(stats.elevationLossM).toBe(50);
  });

  it("skips null altitudes without breaking the elevation series", () => {
    const points = [
      point({ altitudeM: 600, timestampMs: 0 }),
      point({ lat: BASE_LAT + 0.001, altitudeM: null, timestampMs: 10_000 }),
      point({ lat: BASE_LAT + 0.002, altitudeM: 650, timestampMs: 20_000 }),
    ];
    expect(computeTrackStats(points).elevationGainM).toBe(50);
  });

  it("elevation runs across segments (climb made while paused still counts)", () => {
    const points = [
      point({ altitudeM: 600, timestampMs: 0, segment: 0 }),
      point({ lat: BASE_LAT + 0.001, altitudeM: 610, timestampMs: 10_000, segment: 0 }),
      point({ lat: BASE_LAT + 0.002, altitudeM: 700, timestampMs: 600_000, segment: 1 }),
    ];
    expect(computeTrackStats(points).elevationGainM).toBe(100);
  });
});

describe("initialBearingDegrees / compassPointFor", () => {
  it("cardinal directions", () => {
    expect(
      initialBearingDegrees(BASE_LAT, BASE_LON, BASE_LAT + 0.01, BASE_LON),
    ).toBeCloseTo(0, 5);
    expect(
      initialBearingDegrees(BASE_LAT, BASE_LON, BASE_LAT - 0.01, BASE_LON),
    ).toBeCloseTo(180, 5);
    // Due east/west along a parallel: initial bearing off 90/270 by the
    // convergence term — tiny at 0.01°.
    expect(
      initialBearingDegrees(BASE_LAT, BASE_LON, BASE_LAT, BASE_LON + 0.01),
    ).toBeCloseTo(90, 1);
    expect(
      initialBearingDegrees(BASE_LAT, BASE_LON, BASE_LAT, BASE_LON - 0.01),
    ).toBeCloseTo(270, 1);
  });

  it("compass points wrap and round", () => {
    expect(compassPointFor(0)).toBe("N");
    expect(compassPointFor(44)).toBe("NE");
    expect(compassPointFor(359)).toBe("N");
    expect(compassPointFor(225)).toBe("SW");
    expect(compassPointFor(-45)).toBe("NW");
  });
});

describe("formatters", () => {
  it("formats distance", () => {
    expect(formatDistanceM(950)).toBe("950 m");
    expect(formatDistanceM(1050)).toBe("1.1 km");
    expect(formatDistanceM(NaN)).toBe("—");
  });

  it("formats duration", () => {
    expect(formatDurationMs(47 * 60_000)).toBe("47 min");
    expect(formatDurationMs(192 * 60_000)).toBe("3 h 12 min");
    expect(formatDurationMs(-1)).toBe("—");
  });
});
