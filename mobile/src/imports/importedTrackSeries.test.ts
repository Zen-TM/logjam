import { describe, expect, it, vi } from "vitest";
import { computeTrackDetail, type ImportedFeature } from "@logjam/shared";

import { importedFeaturesToSeries } from "./importedTrackSeries";

// The module reaches for the filesystem in its OTHER export; the conversion
// under test is pure.
vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: vi.fn(),
}));

// Synthetic coords only (repo rule): 150.2–150.3 E, −33.6–−33.7 S.
function line(
  coordinates: number[][],
  properties: ImportedFeature["properties"] = {},
): ImportedFeature {
  return { type: "Feature", geometry: { type: "LineString", coordinates }, properties };
}

describe("importedFeaturesToSeries", () => {
  it("keeps the third coordinate as altitude and leaves 2D points without one", () => {
    const series = importedFeaturesToSeries([
      line([
        [150.25, -33.65, 700],
        [150.251, -33.651],
      ]),
    ]);
    expect(series.map((point) => point.altitudeM)).toEqual([700, null]);
  });

  it("gives each line its own segment, so no distance is counted between them", () => {
    // Two lines a long way apart. As separate segments the join contributes
    // nothing; as one series it would book the gap as walked.
    const series = importedFeaturesToSeries([
      line([
        [150.25, -33.65],
        [150.251, -33.65],
      ]),
      line([
        [150.29, -33.69],
        [150.291, -33.69],
      ]),
    ]);
    expect(series.map((point) => point.segment)).toEqual([0, 0, 1, 1]);
    const detail = computeTrackDetail(series);
    // Each hop is ~93 m at this latitude; the 5 km jump between them is not
    // in the total.
    expect(detail.distanceM).toBeLessThan(500);
  });

  it("reads coordTimes into timestamps", () => {
    const series = importedFeaturesToSeries([
      line(
        [
          [150.25, -33.65],
          [150.251, -33.65],
        ],
        { coordTimes: ["2026-08-17T00:00:00.000Z", "2026-08-17T00:01:00.000Z"] },
      ),
    ]);
    expect(series.map((point) => point.timestampMs)).toEqual([
      Date.parse("2026-08-17T00:00:00.000Z"),
      Date.parse("2026-08-17T00:01:00.000Z"),
    ]);
    // With times the whole time-derived half of the panel comes alive.
    expect(computeTrackDetail(series).averageSpeedMps).not.toBeNull();
  });

  it("leaves an untimed file untimed rather than inventing a clock", () => {
    const series = importedFeaturesToSeries([
      line([
        [150.25, -33.65],
        [150.251, -33.65],
      ]),
    ]);
    expect(series.every((point) => point.timestampMs === null)).toBe(true);
    const detail = computeTrackDetail(series);
    expect(detail.distanceM).toBeGreaterThan(0);
    expect(detail.averageSpeedMps).toBeNull();
  });

  it("reads a MultiLineString as one segment per line", () => {
    const series = importedFeaturesToSeries([
      {
        type: "Feature",
        geometry: {
          type: "MultiLineString",
          coordinates: [
            [
              [150.25, -33.65],
              [150.251, -33.65],
            ],
            [
              [150.26, -33.66],
              [150.261, -33.66],
            ],
          ],
        },
        properties: {},
      },
    ]);
    expect(series.map((point) => point.segment)).toEqual([0, 0, 1, 1]);
  });

  it("ignores geometry that is not a line", () => {
    // A waypoint has no distance to report and a polygon's perimeter is not a
    // walk — both would otherwise land in the series as phantom travel.
    expect(
      importedFeaturesToSeries([
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [150.25, -33.65] },
          properties: {},
        },
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [150.25, -33.65],
                [150.26, -33.65],
                [150.26, -33.66],
                [150.25, -33.65],
              ],
            ],
          },
          properties: {},
        },
      ]),
    ).toEqual([]);
  });
});
