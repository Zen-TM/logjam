import { describe, it, expect } from "vitest";
import {
  DEM_ELEVATION_HYSTERESIS_M,
  ELEVATION_PROFILE_MAX_SAMPLES,
  ELEVATION_SAMPLE_SPACING_M,
  buildElevationProfile,
  densifyLine,
  densifyLineSegments,
  elevationGainLoss,
} from "./elevation.js";
import type { RoutePoint } from "./routeValidation.js";

// ~1 km of longitude at this latitude, used to build lines of known length.
const LAT = -33.7;

function eastwardLine(lengthDegrees: number, vertices: number): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let i = 0; i < vertices; i++) {
    points.push([150 + (lengthDegrees * i) / (vertices - 1), LAT]);
  }
  return points;
}

describe("densifyLine", () => {
  it("returns nothing for an empty line", () => {
    expect(densifyLine([])).toEqual([]);
  });

  it("returns the single vertex for a one-point line", () => {
    expect(densifyLine([[150, LAT]])).toEqual([
      { lon: 150, lat: LAT, distanceM: 0 },
    ]);
  });

  it("collapses a zero-length line to one sample instead of dividing by zero", () => {
    const samples = densifyLine([
      [150, LAT],
      [150, LAT],
      [150, LAT],
    ]);
    expect(samples).toEqual([{ lon: 150, lat: LAT, distanceM: 0 }]);
  });

  it("starts at the first vertex and ends exactly at the last", () => {
    const line: RoutePoint[] = [
      [150, LAT],
      [150.01, LAT + 0.01],
      [150.02, LAT],
    ];
    const samples = densifyLine(line);
    expect(samples[0]!.lon).toBeCloseTo(150, 9);
    expect(samples[0]!.lat).toBeCloseTo(LAT, 9);
    expect(samples[0]!.distanceM).toBe(0);
    const last = samples[samples.length - 1]!;
    expect(last.lon).toBeCloseTo(150.02, 9);
    expect(last.lat).toBeCloseTo(LAT, 9);
  });

  it("spaces samples at roughly the target spacing", () => {
    // ~0.01deg of longitude at -33.7 is ~925 m.
    const samples = densifyLine(eastwardLine(0.01, 2));
    for (let i = 1; i < samples.length; i++) {
      const gap = samples[i]!.distanceM - samples[i - 1]!.distanceM;
      expect(gap).toBeLessThanOrEqual(ELEVATION_SAMPLE_SPACING_M + 0.001);
    }
    expect(samples.length).toBeGreaterThan(30);
  });

  it("caps long lines at the sample ceiling rather than spacing", () => {
    // ~1 degree of longitude ~= 92 km, which at 25 m spacing would want ~3700
    // samples.
    const samples = densifyLine(eastwardLine(1, 2));
    expect(samples).toHaveLength(ELEVATION_PROFILE_MAX_SAMPLES);
  });

  it("honours an explicit lower cap", () => {
    expect(densifyLine(eastwardLine(1, 2), 10)).toHaveLength(10);
  });

  it("distances increase monotonically across many vertices", () => {
    const samples = densifyLine(eastwardLine(0.05, 17));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.distanceM).toBeGreaterThan(samples[i - 1]!.distanceM);
    }
  });

  it("interpolates between vertices rather than snapping to them", () => {
    // Two vertices 925 m apart: intermediate samples must be strictly between.
    const samples = densifyLine(eastwardLine(0.01, 2));
    const middle = samples[Math.floor(samples.length / 2)]!;
    expect(middle.lon).toBeGreaterThan(150);
    expect(middle.lon).toBeLessThan(150.01);
  });
});

describe("densifyLineSegments", () => {
  // Two segments ~5 km apart in latitude, so a flat densifyLine across their
  // join would place samples on the teleport line between them.
  const segA: RoutePoint[] = eastwardLine(0.01, 2);
  const segB: RoutePoint[] = eastwardLine(0.01, 2).map(
    (p): RoutePoint => [p[0] + 0.02, LAT + 0.05],
  );

  it("never samples the gap between two segments", () => {
    const samples = densifyLineSegments([segA, segB]);
    expect(samples.length).toBeGreaterThan(30);
    for (const sample of samples) {
      const onA = Math.abs(sample.lat - LAT) < 1e-6;
      const onB = Math.abs(sample.lat - (LAT + 0.05)) < 1e-6;
      expect(onA || onB).toBe(true);
    }
  });

  it("runs its distance continuously across the whole combined length", () => {
    const samples = densifyLineSegments([segA, segB]);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.distanceM).toBeGreaterThan(samples[i - 1]!.distanceM);
    }
    expect(samples[0]!.distanceM).toBe(0);
  });

  it("starts at the first vertex and ends at the last", () => {
    const samples = densifyLineSegments([segA, segB]);
    const first = segA[0]!;
    const last = segB[segB.length - 1]!;
    expect(samples[0]!.lon).toBeCloseTo(first[0], 9);
    expect(samples[0]!.lat).toBeCloseTo(first[1], 9);
    const end = samples[samples.length - 1]!;
    expect(end.lon).toBeCloseTo(last[0], 9);
    expect(end.lat).toBeCloseTo(last[1], 9);
  });

  it("delegates a single segment to densifyLine", () => {
    expect(densifyLineSegments([segA])).toEqual(densifyLine(segA));
  });

  it("treats a single-point segment as a break, not a sample", () => {
    const lone: RoutePoint[] = [[150.5, -33.5]];
    const samples = densifyLineSegments([segA, lone, segB]);
    for (const sample of samples) {
      const onA = Math.abs(sample.lat - LAT) < 1e-6;
      const onB = Math.abs(sample.lat - (LAT + 0.05)) < 1e-6;
      expect(onA || onB).toBe(true);
    }
  });

  it("returns nothing for an empty segment list", () => {
    expect(densifyLineSegments([])).toEqual([]);
  });
});

describe("elevationGainLoss", () => {
  it("is zero for a flat series", () => {
    expect(elevationGainLoss([100, 100, 100], 5)).toEqual({
      gainM: 0,
      lossM: 0,
    });
  });

  it("counts a monotone climb once", () => {
    const { gainM, lossM } = elevationGainLoss([100, 150, 200, 250], 5);
    expect(gainM).toBe(150);
    expect(lossM).toBe(0);
  });

  it("counts a monotone descent once", () => {
    const { gainM, lossM } = elevationGainLoss([250, 200, 150, 100], 5);
    expect(gainM).toBe(0);
    expect(lossM).toBe(150);
  });

  it("counts an up-and-back-down as both", () => {
    const { gainM, lossM } = elevationGainLoss([100, 200, 100], 5);
    expect(gainM).toBe(100);
    expect(lossM).toBe(100);
  });

  it("swallows wobble below the threshold instead of double counting it", () => {
    // A 2 m sawtooth repeated 50 times: naive summing reads 100 m of gain.
    const noisy: number[] = [];
    for (let i = 0; i < 50; i++) noisy.push(500, 502);
    const { gainM, lossM } = elevationGainLoss(noisy, 5);
    expect(gainM).toBe(0);
    expect(lossM).toBe(0);
  });

  it("still sees real climb hidden under wobble", () => {
    // 2 m sawtooth riding on a 100 m climb.
    const series: number[] = [];
    for (let i = 0; i < 50; i++) series.push(500 + i * 2, 502 + i * 2);
    const { gainM } = elevationGainLoss(series, 5);
    expect(gainM).toBeGreaterThan(90);
    expect(gainM).toBeLessThanOrEqual(100);
  });

  it("skips gaps rather than treating them as sea level", () => {
    const withGap = elevationGainLoss([100, null, 200], 5);
    const without = elevationGainLoss([100, 200], 5);
    expect(withGap).toEqual(without);
  });

  it("ignores non-finite values", () => {
    expect(elevationGainLoss([100, NaN, Infinity, 200], 5)).toEqual({
      gainM: 100,
      lossM: 0,
    });
  });

  it("reports nothing for an all-null series", () => {
    expect(elevationGainLoss([null, null], 5)).toEqual({ gainM: 0, lossM: 0 });
  });

  it("uses a DEM threshold well below the GPS one", () => {
    // The whole reason the constant is separate: a 10 m rise is real terrain
    // to a DEM and noise to a GPS altimeter.
    expect(DEM_ELEVATION_HYSTERESIS_M).toBeLessThan(15);
    expect(elevationGainLoss([100, 110, 100], DEM_ELEVATION_HYSTERESIS_M)).toEqual({
      gainM: 10,
      lossM: 10,
    });
  });
});

describe("buildElevationProfile", () => {
  const positions = [
    { lon: 150, lat: LAT, distanceM: 0 },
    { lon: 150.001, lat: LAT, distanceM: 100 },
    { lon: 150.002, lat: LAT, distanceM: 200 },
  ];

  it("pairs each height with its own distance", () => {
    const profile = buildElevationProfile(positions, [100, 160, 120]);
    expect(profile.samples).toEqual([
      { distanceM: 0, elevationM: 100 },
      { distanceM: 100, elevationM: 160 },
      { distanceM: 200, elevationM: 120 },
    ]);
    expect(profile.gainM).toBe(60);
    expect(profile.lossM).toBe(40);
    expect(profile.minM).toBe(100);
    expect(profile.maxM).toBe(160);
  });

  it("reports null extremes when the DEM covered nothing", () => {
    const profile = buildElevationProfile(positions, [null, null, null]);
    expect(profile.minM).toBeNull();
    expect(profile.maxM).toBeNull();
    expect(profile.gainM).toBe(0);
  });

  it("throws on a misaligned pair rather than mislabelling distances", () => {
    expect(() => buildElevationProfile(positions, [100, 200])).toThrow(
      /does not match/,
    );
  });
});
