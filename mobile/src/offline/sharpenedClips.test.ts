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

  // Red if a box that misses the area gets a range: it would cut a clip of
  // tiles the area doesn't hold.
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

  // Red if an area with no contour archive gets a contours clip: its null
  // URL would fail the save.
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

describe("areasForSave", () => {
  const query = (over: object) => ({
    data: null,
    loading: false,
    error: null,
    ...over,
  });
  // Red if a signed-in save may go ahead while the list is loading or has
  // failed: it would save no sharpened terrain and say nothing.
  it("lets a signed-in save go ahead only once the list has loaded", async () => {
    const { areasForSave } = await import("./sharpenedClips");
    expect(areasForSave(true, query({ loading: true }))).toBe("loading");
    expect(areasForSave(true, query({}))).toBe("loading");
    expect(areasForSave(true, query({ error: "Couldn't load" }))).toBe(
      "failed",
    );
    expect(areasForSave(true, query({ data: { jobs: [] } }))).toBe("ready");
    // A failed refresh of a loaded list is still a failure to say.
    expect(
      areasForSave(true, query({ data: { jobs: [] }, error: "Couldn't load" })),
    ).toBe("failed");
  });

  // Red if a guest's save waits on a list they can't have.
  it("asks a guest for nothing", async () => {
    const { areasForSave } = await import("./sharpenedClips");
    expect(areasForSave(false, query({}))).toBe("none");
  });
});

describe("saveGate", () => {
  // Red if offline lets a save queue instead of asking for a connection, or a
  // failed list blocks Save offline: the gate and the tap must read the same
  // connectivity, or a save with no area list leaves the areas out quietly.
  it("asks for a connection offline, and online warns with a way to save without the areas", async () => {
    const { saveGate } = await import("./sharpenedClips");
    expect(saveGate("failed", true)).toEqual({
      canSave: false,
      warning: "failed",
      noConnection: false,
    });
    expect(saveGate("failed", false)).toEqual({
      canSave: true,
      warning: null,
      noConnection: true,
    });
    expect(saveGate("loading", true)).toEqual({
      canSave: false,
      warning: "loading",
      noConnection: false,
    });
    expect(saveGate("ready", true)).toEqual({
      canSave: true,
      warning: null,
      noConnection: false,
    });
  });

  // Red if a guest's Save waits on a list they can't have, or any offline
  // state saves without the "needs a connection" alert.
  it("lets a guest save, and asks for a connection in every offline state", async () => {
    const { saveGate } = await import("./sharpenedClips");
    expect(saveGate("none", true)).toEqual({
      canSave: true,
      warning: null,
      noConnection: false,
    });
    for (const areas of ["none", "loading", "failed", "ready"] as const)
      expect(saveGate(areas, false)).toEqual({
        canSave: true,
        warning: null,
        noConnection: true,
      });
  });

  // Red if any state lets a save queue (Save enabled and no connection alert)
  // while the area list is loading or has failed.
  it("never queues a save while the area list is loading or has failed", async () => {
    const { saveGate } = await import("./sharpenedClips");
    for (const areas of ["none", "loading", "failed", "ready"] as const)
      for (const online of [true, false]) {
        const gate = saveGate(areas, online);
        if (gate.canSave && !gate.noConnection)
          expect(["none", "ready"]).toContain(areas);
      }
  });
});
