import { describe, expect, it, vi } from "vitest";

vi.mock("./prisma", () => ({ default: {} }));

import { sharpenedAreaFrom } from "./sharpenedAreas";

// A made-up result, as topo/sharpen.py and topo/worker.py write it.
const result = {
  v: 1,
  zmax: 16,
  tiles15: [30100, 19400, 30103, 19403],
  coverage: [150.7, -33.8, 150.72, -33.78],
  ground: "class-2",
  extracted: "March 2025",
  credit: "Elevation: derived from a LiDAR survey. CC BY 3.0 AU.",
  keys: {
    heights: "outputs/job-1/heights.pmtiles",
    slope: "outputs/job-1/slope.pmtiles",
    contours: "outputs/job-1/contours.pmtiles",
  },
  vegetation: false,
};
const row = (sharpen: unknown) => ({
  id: "job-1",
  createdAt: new Date("2026-10-24T00:00:00.000Z"),
  sharpen,
});

describe("sharpenedAreaFrom", () => {
  it("reads a sharpened job's result", () => {
    expect(sharpenedAreaFrom(row(result))).toEqual({
      id: "job-1",
      zmax: 16,
      tiles15: [30100, 19400, 30103, 19403],
      coverage: [150.7, -33.8, 150.72, -33.78],
      contours: true,
      credit: result.credit,
      createdAt: "2026-10-24T00:00:00.000Z",
      keys: result.keys,
    });
  });

  it("knows an area with no contour archive", () => {
    const { contours: _, ...keys } = result.keys;
    expect(sharpenedAreaFrom(row({ ...result, keys }))).toMatchObject({
      contours: false,
      keys: { contours: null },
    });
  });

  it("is no area for a legacy job, a job still marked, or a result it cannot read", () => {
    expect(sharpenedAreaFrom(row(null))).toBeNull();
    expect(sharpenedAreaFrom(row({ v: 1, vegetation: true }))).toBeNull();
    expect(sharpenedAreaFrom(row({ ...result, v: 2 }))).toBeNull();
    expect(sharpenedAreaFrom(row({ ...result, zmax: 15 }))).toBeNull();
    expect(
      sharpenedAreaFrom(row({ ...result, tiles15: [1, 2, 3] })),
    ).toBeNull();
    const { credit: _, ...uncredited } = result;
    expect(sharpenedAreaFrom(row(uncredited))).toBeNull();
  });

  // Mutation: take a key as stored, and a bad row points the API's role at
  // another job's object (or any object in the bucket).
  it("refuses a key outside the job's own outputs", () => {
    for (const heights of [
      "outputs/job-2/heights.pmtiles",
      "master/dem/nsw-5m.pmtiles",
      "outputs/job-10/heights.pmtiles",
    ])
      expect(
        sharpenedAreaFrom(
          row({ ...result, keys: { ...result.keys, heights } }),
        ),
        heights,
      ).toBeNull();
  });
});
