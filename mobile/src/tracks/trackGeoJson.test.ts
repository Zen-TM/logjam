import { describe, expect, it } from "vitest";
import type { RecordedTrackPoint } from "@logjam/shared";

import { trackPointsToFeature } from "./trackGeoJson";

// Synthetic coords only (repo rule).
function point(lon: number, lat: number, segment: number): RecordedTrackPoint {
  return { lon, lat, altitudeM: null, accuracyM: null, timestampMs: 0, segment };
}

describe("trackPointsToFeature", () => {
  it("empty and single-point tracks produce no line strings", () => {
    expect(trackPointsToFeature([]).geometry.coordinates).toEqual([]);
    expect(
      trackPointsToFeature([point(150.2, -33.6, 0)]).geometry.coordinates,
    ).toEqual([]);
  });

  it("splits segments into separate line strings", () => {
    const feature = trackPointsToFeature([
      point(150.2, -33.6, 0),
      point(150.21, -33.6, 0),
      point(150.25, -33.65, 1),
      point(150.26, -33.65, 1),
      point(150.27, -33.65, 1),
    ]);
    expect(feature.geometry.coordinates).toEqual([
      [
        [150.2, -33.6],
        [150.21, -33.6],
      ],
      [
        [150.25, -33.65],
        [150.26, -33.65],
        [150.27, -33.65],
      ],
    ]);
  });

  it("drops 1-point segments but keeps neighbours", () => {
    const feature = trackPointsToFeature([
      point(150.2, -33.6, 0),
      point(150.21, -33.6, 0),
      point(150.25, -33.65, 1), // lone point after a resume — no line
      point(150.3, -33.7, 2),
      point(150.31, -33.7, 2),
    ]);
    expect(feature.geometry.coordinates).toHaveLength(2);
    expect(feature.geometry.coordinates[1][0]).toEqual([150.3, -33.7]);
  });
});
