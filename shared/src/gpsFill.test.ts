// A recorded track's own GPS heights fill what no DEM covers.
// Synthetic coordinates and heights only.
import { describe, expect, it } from "vitest";

import type { DemSamples } from "./demSources.js";
import {
  buildElevationProfile,
  climbFromProfile,
  densifyLineSegments,
  gpsAlongLine,
  type GpsHeight,
  type SamplePosition,
} from "./elevation.js";
import type { RoutePoint } from "./routeValidation.js";
import { buildTrackElevationProfile, fillDemFromGps } from "./trackStats.js";

const dem = (heights: (number | null)[]): DemSamples => ({
  heights,
  levelled: heights.slice(),
  sourceIds: heights.map((height) => (height == null ? null : "nsw-5m")),
});
const every = (stepM: number, count: number): SamplePosition[] =>
  Array.from({ length: count }, (_, i) => ({
    lon: 150.4,
    lat: -33.5,
    distanceM: i * stepM,
  }));
/** One fix per height, `stepM` apart. */
const fixes = (stepM: number, heights: number[]): GpsHeight[] =>
  heights.map((heightM, i) => ({ distanceM: i * stepM, heightM }));

describe("fillDemFromGps", () => {
  // The track climbs 78 m in all; GPS reads 22 m above the DEM throughout.
  const left = dem([500, 510, 520, null, null, null]);
  const at = every(25, 6);
  const gps = fixes(25, [522, 532, 542, 560, 580, 600]);

  // Mutation: step from the DEM height to the GPS height at the join and the
  // 22 m between the two surfaces is counted as climb (100 m, not 78).
  it("counts the climb past the DEM's edge, and not the offset at the join", () => {
    const profile = buildElevationProfile(at, fillDemFromGps(left, at, gps));
    expect(profile.gainM).toBeCloseTo(78, 6);
    expect(profile.lossM).toBe(0);
  });

  it("keeps the DEM where it answered and names GPS where it did not", () => {
    const filled = fillDemFromGps(left, at, gps);
    expect(filled.heights.slice(0, 3)).toEqual([500, 510, 520]);
    expect(filled.sourceIds).toEqual([
      "nsw-5m",
      "nsw-5m",
      "nsw-5m",
      "gps",
      "gps",
      "gps",
    ]);
  });

  // Mutation: chart the GPS heights as read and the line jumps 22 m at the
  // edge of the saved area, and the high point is 22 m too high.
  it("charts a stretch past the DEM's edge shifted to meet it", () => {
    expect(fillDemFromGps(left, at, gps).heights.slice(3)).toEqual([
      538, 558, 578,
    ]);
  });

  // GPS drifted from 20 m high to 30 m high across the gap.
  // Mutation: shift the stretch by one figure and the 10 m of drift shows as
  // a step where it meets the DEM.
  it("ramps the shift across a stretch inside the DEM, so neither join steps", () => {
    const filled = fillDemFromGps(
      dem([500, null, null, 500]),
      every(25, 4),
      fixes(25, [520, 525, 528, 530]),
    );
    expect(filled.heights[1]).toBeCloseTo(525 - 20 - 10 / 3, 6);
    expect(filled.heights[2]).toBeCloseTo(528 - 20 - 20 / 3, 6);
  });

  // Mutation: use the GPS heights without holding them still and their
  // wander, here 7 to 9 m a sample, is summed at the DEM's 5 m threshold.
  it("does not count GPS wander on level ground", () => {
    const flat = dem([500, 500, null, null, null, null, null, null, 500]);
    const wander = fixes(25, [521, 520, 520, 527, 519, 526, 518, 527, 520]);
    const profile = buildElevationProfile(
      every(25, 9),
      fillDemFromGps(flat, every(25, 9), wander),
    );
    expect(profile.gainM).toBe(0);
    expect(profile.lossM).toBe(0);
  });

  // Samples a kilometre apart, with a 60 m rise and fall between each pair.
  // Mutation: sum the stretch from one GPS height per sample and all of it is
  // lost: every sample reads 520.
  it("sums a filled stretch from every fix, not one height per sample", () => {
    const sparse = every(1000, 3);
    const profile = buildElevationProfile(
      sparse,
      fillDemFromGps(
        dem([500, null, null]),
        sparse,
        fixes(500, [520, 580, 520, 580, 520]),
      ),
    );
    expect(profile.gainM).toBe(120);
    expect(profile.lossM).toBe(120);
    expect(profile.samples).toHaveLength(3);
  });

  it("returns a profile untouched when there is nothing to fill it with or from", () => {
    const whole = dem([500, 510]);
    expect(fillDemFromGps(whole, every(25, 2), fixes(25, [520, 530]))).toBe(
      whole,
    );
    const none = dem([null, null]);
    expect(fillDemFromGps(none, every(25, 2), fixes(25, [520, 530]))).toBe(
      none,
    );
    expect(fillDemFromGps(left, at, [])).toBe(left);
  });

  // Mutation: label a filled climb with its DEM and the upgrade pass never
  // replaces the stretch that came from GPS.
  it("makes a climb that is stored as GPS", () => {
    const profile = buildElevationProfile(at, fillDemFromGps(left, at, gps));
    expect(profile.filledFromGps).toBe(true);
    expect(profile.demSourceIds).toEqual(["nsw-5m"]);
    expect(climbFromProfile(profile)?.elevationSource).toBe("gps");
    expect(
      buildElevationProfile(every(25, 3), dem([1, 2, 3])).filledFromGps,
    ).toBeUndefined();
  });
});

describe("gpsAlongLine", () => {
  const first: RoutePoint[] = [
    [150.4, -33.5],
    [150.41, -33.5],
    [150.42, -33.5],
  ];
  const second: RoutePoint[] = [
    [150.6, -33.5],
    [150.61, -33.5],
  ];
  const lengthM = (line: RoutePoint[]) => {
    const at = densifyLineSegments([line]);
    return at[at.length - 1]!.distanceM;
  };

  it("places a fix between the two vertices it was recorded between", () => {
    const placed = gpsAlongLine(
      [first],
      [
        [
          { vertex: 0, heightM: 1 },
          { vertex: 0.5, heightM: 2 },
          { vertex: 2, heightM: 3 },
        ],
      ],
    );
    expect(placed.map((fix) => fix.heightM)).toEqual([1, 2, 3]);
    expect(placed[0]!.distanceM).toBe(0);
    expect(placed[1]!.distanceM).toBeCloseTo(lengthM(first) / 4, 3);
    expect(placed[2]!.distanceM).toBeCloseTo(lengthM(first), 3);
  });

  // Mutation: restart the distance at each segment and the second segment's
  // fixes land on the first one's samples.
  it("carries on from the walked length of the segments before", () => {
    const placed = gpsAlongLine(
      [first, second],
      [[{ vertex: 2, heightM: 1 }], [{ vertex: 1, heightM: 2 }]],
    );
    expect(placed[1]!.distanceM).toBeCloseTo(
      lengthM(first) + lengthM(second),
      3,
    );
  });

  it("is empty when the fixes do not match the line", () => {
    expect(gpsAlongLine([first, second], [[]])).toEqual([]);
    expect(gpsAlongLine([first], [[{ vertex: 2.5, heightM: 1 }]])).toEqual([]);
  });
});

describe("buildTrackElevationProfile", () => {
  const line: RoutePoint[] = [
    [150.4, -33.5],
    [150.42, -33.5],
  ];
  const at = densifyLineSegments([line]);
  const half = dem(at.map((_, i) => (i < at.length / 2 ? 600 : null)));

  it("fills from the track's heights when it is given them", () => {
    const profile = buildTrackElevationProfile(
      [line],
      [
        [
          { vertex: 0, heightM: 620 },
          { vertex: 1, heightM: 620 },
        ],
      ],
      at,
      half,
    );
    expect(profile.filledFromGps).toBe(true);
    expect(profile.samples.every((sample) => sample.elevationM === 600)).toBe(
      true,
    );
  });

  it("is the plain DEM profile without them", () => {
    const profile = buildTrackElevationProfile([line], null, at, half);
    expect(profile.filledFromGps).toBeUndefined();
    expect(profile.samples[at.length - 1]!.elevationM).toBeNull();
  });
});
