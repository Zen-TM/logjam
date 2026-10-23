import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./prisma", () => ({ default: {} }));

import { sharpenedAreaFrom } from "./sharpenedAreas";

// The example both sides' tests read: what topo/sharpen.py and
// topo/worker.py store, made up.
const example = JSON.parse(
  readFileSync(
    join(__dirname, "../../../shared/src/__fixtures__/sharpen-result.json"),
    "utf8",
  ),
) as {
  jobId: string;
  stored: Record<string, unknown> & {
    keys: Record<string, string>;
    credit: string;
  };
};
const result = example.stored;
const row = (sharpen: unknown) => ({
  id: example.jobId,
  createdAt: new Date("2026-10-24T00:00:00.000Z"),
  sharpen,
});

describe("sharpenedAreaFrom", () => {
  // Mutation: a field renamed or retyped on either side, and every area
  // silently disappears (topo/tests/test_sharpen.py reads the same example).
  it("reads a sharpened job's result", () => {
    expect(sharpenedAreaFrom(row(result))).toEqual({
      id: "job-1",
      zmax: result.zmax,
      tiles15: result.tiles15,
      coverage: result.coverage,
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

  // Mutation: accept a result of an unknown version, a mark the worker has
  // not replaced, a zmax with no archive, or one with no credit.
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
