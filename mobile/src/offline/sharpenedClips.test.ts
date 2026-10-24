import { describe, expect, it } from "vitest";
import type { SharpenedOverlay } from "@logjam/shared";

import { tileRectBounds } from "../map/terrainRoutes";
import { areaClipBytes, areaClipSpecs, areaRangeIn } from "./sharpenedClips";

// A made-up area of 4 × 4 z15 tiles.
const area = (contoursUrl: string | null = "https://b.example/c?sig=c") =>
  ({
    id: "a1",
    zmax: 17,
    tiles15: [100, 200, 103, 203],
    coverage: [0, 0, 0, 0],
    contours: contoursUrl != null,
    credit: "Made-up credit",
    createdAt: "2026-10-01T00:00:00Z",
    heightsUrl: "https://b.example/h?sig=h",
    slopeUrl: "https://b.example/s?sig=s",
    contoursUrl,
  }) satisfies SharpenedOverlay;

/** The bbox of z15 tiles, drawn in a hair as a saved area's frame is. */
const bboxOf = (rect: readonly [number, number, number, number]) => {
  const [west, south, east, north] = tileRectBounds(15, rect);
  return { west, south, east, north };
};

const run = {
  groupId: "g1",
  groupLabel: "Area",
  allowCellular: false,
};

describe("areaRangeIn", () => {
  // Red if the range isn't widened to whole z14 tiles: the area's contours,
  // routed by z14 tile, would leave a strip with neither archive's lines.
  it("widens to whole z14 tiles, inside the area", () => {
    expect(areaRangeIn(area(), bboxOf([101, 201, 101, 201]))).toEqual([
      100, 200, 101, 201,
    ]);
    expect(areaRangeIn(area(), bboxOf([95, 195, 110, 210]))).toEqual([
      100, 200, 103, 203,
    ]);
  });

  it("is null for a saved area that misses the area", () => {
    expect(areaRangeIn(area(), bboxOf([110, 210, 111, 211]))).toBeNull();
  });
});

describe("areaClipSpecs", () => {
  // Red if a layer is dropped, a clip names the statewide key, or a missed
  // area gets clips.
  it("cuts the heights, the slope and the contours of each area reached, under the area", () => {
    let n = 0;
    const bbox = bboxOf([101, 201, 102, 202]);
    const specs = areaClipSpecs({ ...run, bbox }, [area()], () => `c${n++}`);
    expect(specs.map((s) => [s.basemapId, s.area?.layer, s.area?.url])).toEqual(
      [
        ["lidar-a1", "heights", "https://b.example/h?sig=h"],
        ["lidar-a1", "slope", "https://b.example/s?sig=s"],
        ["lidar-a1", "contours", "https://b.example/c?sig=c"],
      ],
    );
    expect(specs.every((s) => s.area?.zmax === 17)).toBe(true);
    expect(specs[0]!.area?.tiles).toEqual([100, 200, 103, 203]);
    expect(
      areaClipSpecs(
        { ...run, bbox: bboxOf([110, 210, 111, 211]) },
        [area()],
        () => "x",
      ),
    ).toEqual([]);
  });

  it("cuts no contours for an area that has none", () => {
    const specs = areaClipSpecs(
      { ...run, bbox: bboxOf([101, 201, 101, 201]) },
      [area(null)],
      () => "x",
    );
    expect(specs.map((s) => s.area?.layer)).toEqual(["heights", "slope"]);
  });
});

describe("areaClipBytes", () => {
  // Red if the estimate leaves the areas out, or counts the whole area for
  // a saved area that reaches part of it.
  it("prices the part of each area a saved area reaches", () => {
    const quarter = areaClipBytes([area()], bboxOf([100, 200, 101, 201]));
    const whole = areaClipBytes([area()], bboxOf([95, 195, 110, 210]));
    expect(quarter).toBeGreaterThan(0);
    expect(whole).toBe(quarter * 4);
    expect(areaClipBytes([area()], bboxOf([110, 210, 111, 211]))).toBe(0);
  });
});
