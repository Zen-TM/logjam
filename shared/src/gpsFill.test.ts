// A recorded track's own GPS heights fill what no DEM covers.
// Synthetic coordinates and heights only.
import { describe, expect, it } from "vitest";

import type { DemSamples } from "./demSources.js";
import {
  buildElevationProfile,
  climbFromProfile,
  densifyLineSegments,
  heightsAlongLine,
  type SamplePosition,
} from "./elevation.js";
import type { RoutePoint } from "./routeValidation.js";
import { buildTrackElevationProfile, fillDemFromGps } from "./trackStats.js";

const dem = (heights: (number | null)[]): DemSamples => ({
  heights,
  levelled: heights.slice(),
  sourceIds: heights.map((height) => (height == null ? null : "nsw-5m")),
});
const positions = (count: number): SamplePosition[] =>
  Array.from({ length: count }, (_, i) => ({
    lon: 150.4,
    lat: -33.5,
    distanceM: i * 25,
  }));

describe("fillDemFromGps", () => {
  // The track climbs 78 m in all; GPS reads 22 m above the DEM throughout.
  const left = dem([500, 510, 520, null, null, null]);
  const gps = [522, 532, 542, 560, 580, 600];

  // Mutation: step from the DEM height to the GPS height at the join and the
  // 22 m between the two surfaces is counted as climb (100 m, not 78).
  it("counts the climb past the DEM's edge, and not the offset at the join", () => {
    const profile = buildElevationProfile(
      positions(6),
      fillDemFromGps(left, gps),
    );
    expect(profile.gainM).toBeCloseTo(78, 6);
    expect(profile.lossM).toBe(0);
  });

  it("keeps the DEM where it answered and names GPS where it did not", () => {
    const filled = fillDemFromGps(left, gps);
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
  it("charts the filled stretch shifted to meet the DEM", () => {
    expect(fillDemFromGps(left, gps).heights.slice(3)).toEqual([538, 558, 578]);
  });

  it("takes the offset from both sides of a stretch inside the DEM", () => {
    // GPS drifted from 20 m high to 30 m high across the gap.
    const filled = fillDemFromGps(dem([500, null, 500]), [520, 525, 530]);
    expect(filled.heights[1]).toBe(500);
  });

  // Mutation: use the GPS heights without holding them still and their
  // wander, here 7 to 9 m a sample, is summed at the DEM's 5 m threshold.
  it("does not count GPS wander on level ground", () => {
    const flat = dem([500, 500, null, null, null, null, null, null, 500]);
    const wander = [521, 520, 520, 527, 519, 526, 518, 527, 520];
    const profile = buildElevationProfile(
      positions(9),
      fillDemFromGps(flat, wander),
    );
    expect(profile.gainM).toBe(0);
    expect(profile.lossM).toBe(0);
  });

  it("leaves a sample with neither a DEM nor a GPS height empty", () => {
    const filled = fillDemFromGps(dem([500, null, null]), [520, null, 540]);
    expect(filled.heights[1]).toBeNull();
    expect(filled.heights[2]).toBe(520);
  });

  it("returns a profile untouched when there is nothing to fill or no DEM at all", () => {
    const whole = dem([500, 510]);
    expect(fillDemFromGps(whole, [520, 530])).toBe(whole);
    const none = dem([null, null]);
    expect(fillDemFromGps(none, [520, 530])).toBe(none);
  });

  // Mutation: label a filled climb with its DEM and the upgrade pass never
  // replaces the stretch that came from GPS.
  it("makes a climb that is stored as GPS", () => {
    const profile = buildElevationProfile(
      positions(6),
      fillDemFromGps(left, gps),
    );
    expect(profile.filledFromGps).toBe(true);
    expect(profile.demSourceIds).toEqual(["nsw-5m"]);
    expect(climbFromProfile(profile)?.elevationSource).toBe("gps");
    expect(
      buildElevationProfile(positions(3), dem([1, 2, 3])).filledFromGps,
    ).toBeUndefined();
  });
});

describe("heightsAlongLine", () => {
  const first: RoutePoint[] = [
    [150.4, -33.5],
    [150.41, -33.5],
    [150.42, -33.5],
  ];
  const second: RoutePoint[] = [
    [150.6, -33.5],
    [150.61, -33.5],
  ];

  it("reads a height between the two vertices a position lies between", () => {
    const at = densifyLineSegments([first]);
    const heights = heightsAlongLine([first], [[0, 100, 200]], at);
    const totalM = at[at.length - 1]!.distanceM;
    at.forEach((position, i) =>
      expect(heights[i]).toBeCloseTo((position.distanceM / totalM) * 200, 3),
    );
  });

  // Mutation: interpolate across the join and a pause gap's two sides bleed
  // into each other.
  it("never blends the two sides of a gap between segments", () => {
    const at = densifyLineSegments([first, second]);
    const heights = heightsAlongLine(
      [first, second],
      [
        [0, 0, 0],
        [1000, 1000],
      ],
      at,
    );
    expect(new Set(heights)).toEqual(new Set([0, 1000]));
    expect(heights[0]).toBe(0);
    expect(heights[heights.length - 1]).toBe(1000);
  });

  it("lends a vertex with no height its neighbour's", () => {
    const at = densifyLineSegments([second]);
    expect(
      heightsAlongLine([second], [[null, 640]], at).every((h) => h === 640),
    ).toBe(true);
  });

  it("is all null when the heights do not match the line", () => {
    const at = densifyLineSegments([first]);
    expect(heightsAlongLine([first], [[0, 100]], at)).toEqual(
      at.map(() => null),
    );
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
    const profile = buildTrackElevationProfile([line], [[620, 620]], at, half);
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
