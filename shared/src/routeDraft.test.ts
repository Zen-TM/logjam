import { describe, it, expect } from "vitest";
import {
  appendAnchor,
  deleteAnchor,
  draftAnchorIndices,
  draftFromRoute,
  draftPointCount,
  draftPoints,
  emptyDraft,
  insertAnchor,
  moveAnchor,
  nearestSegment,
  reverseDraft,
  setFiller,
  type RouteDraft,
} from "./routeDraft.js";
import {
  reverseRoute,
  reverseRouteAnchors,
  type RoutePoint,
} from "./routeValidation.js";

const A: RoutePoint = [150, -33];
const B: RoutePoint = [150.01, -33];
const C: RoutePoint = [150.02, -33];
const fillAB: RoutePoint[] = [
  [150.003, -33.001],
  [150.006, -33.001],
];

/** Two anchors with a snapped run between them. */
const snapped: RouteDraft = { anchors: [A, B], filler: [fillAB] };

describe("draftPoints / anchor indices", () => {
  it("is empty for an empty draft", () => {
    expect(draftPoints(emptyDraft)).toEqual([]);
    expect(draftAnchorIndices(emptyDraft)).toEqual([]);
  });

  it("interleaves filler between its anchors", () => {
    expect(draftPoints(snapped)).toEqual([A, ...fillAB, B]);
  });

  it("reports where the anchors landed in the flattened points", () => {
    expect(draftAnchorIndices(snapped)).toEqual([0, 3]);
  });

  it("counts what would be saved", () => {
    expect(draftPointCount(snapped)).toBe(4);
    expect(draftPointCount(emptyDraft)).toBe(0);
  });

  it("keeps indices right across several segments", () => {
    const draft: RouteDraft = { anchors: [A, B, C], filler: [fillAB, []] };
    expect(draftAnchorIndices(draft)).toEqual([0, 3, 4]);
    expect(draftPoints(draft)).toEqual([A, ...fillAB, B, C]);
  });
});

describe("appendAnchor", () => {
  it("adds the first anchor without a filler slot", () => {
    const draft = appendAnchor(emptyDraft, A);
    expect(draft.anchors).toEqual([A]);
    expect(draft.filler).toEqual([]);
  });

  it("opens a straight segment behind each later anchor", () => {
    const draft = appendAnchor(appendAnchor(emptyDraft, A), B);
    expect(draft.filler).toEqual([[]]);
    expect(draftPoints(draft)).toEqual([A, B]);
  });
});

describe("setFiller", () => {
  it("attaches a snapped run to the segment it was computed for", () => {
    const straight = appendAnchor(appendAnchor(emptyDraft, A), B);
    const draft = setFiller(straight, A, B, fillAB);
    expect(draftPoints(draft)).toEqual([A, ...fillAB, B]);
  });

  it("ignores a run whose segment no longer exists", () => {
    // The whole point: snapping is async, and the user may have undone the
    // segment before the answer arrived. Applying it would staple a track onto
    // a segment that isn't there.
    const straight = appendAnchor(appendAnchor(emptyDraft, A), B);
    const undone = deleteAnchor(straight, 1);
    expect(setFiller(undone, A, B, fillAB)).toBe(undone);
  });

  it("ignores a run whose end anchor has moved", () => {
    const straight = appendAnchor(appendAnchor(emptyDraft, A), B);
    const moved = moveAnchor(straight, 1, C);
    expect(draftPoints(setFiller(moved, A, B, fillAB))).toEqual([A, C]);
  });
});

describe("moveAnchor", () => {
  it("moves the point", () => {
    expect(moveAnchor(snapped, 1, C).anchors).toEqual([A, C]);
  });

  it("drops filler that followed a track to the OLD position", () => {
    // Keeping it would leave the line running to where the point used to be.
    expect(draftPoints(moveAnchor(snapped, 1, C))).toEqual([A, C]);
  });

  it("drops filler on both sides of a middle anchor", () => {
    const draft: RouteDraft = { anchors: [A, B, C], filler: [fillAB, fillAB] };
    const moved = moveAnchor(draft, 1, [150.015, -33.002]);
    expect(moved.filler).toEqual([[], []]);
  });

  it("ignores an out-of-range index", () => {
    expect(moveAnchor(snapped, 9, C)).toBe(snapped);
  });
});

describe("deleteAnchor", () => {
  it("removes the point and joins its neighbours", () => {
    const draft: RouteDraft = { anchors: [A, B, C], filler: [fillAB, fillAB] };
    const next = deleteAnchor(draft, 1);
    expect(next.anchors).toEqual([A, C]);
    expect(draftPoints(next)).toEqual([A, C]);
  });

  it("drops the leading segment when the first anchor goes", () => {
    const draft: RouteDraft = { anchors: [A, B, C], filler: [fillAB, []] };
    const next = deleteAnchor(draft, 0);
    expect(next.anchors).toEqual([B, C]);
    expect(next.filler).toEqual([[]]);
  });

  it("drops the trailing segment when the last anchor goes", () => {
    const draft: RouteDraft = { anchors: [A, B, C], filler: [fillAB, []] };
    const next = deleteAnchor(draft, 2);
    expect(next.anchors).toEqual([A, B]);
    expect(next.filler).toEqual([fillAB]);
  });

  it("leaves no dangling filler when it drops to one anchor", () => {
    const next = deleteAnchor(snapped, 1);
    expect(next.anchors).toEqual([A]);
    expect(next.filler).toEqual([]);
  });
});

describe("insertAnchor", () => {
  it("splits a segment in two, both straight", () => {
    const mid: RoutePoint = [150.005, -33.004];
    const next = insertAnchor(snapped, 0, mid);
    expect(next.anchors).toEqual([A, mid, B]);
    expect(next.filler).toEqual([[], []]);
    expect(draftPoints(next)).toEqual([A, mid, B]);
  });

  it("ignores a segment index past the end", () => {
    expect(insertAnchor(snapped, 5, C)).toBe(snapped);
  });
});

describe("draftFromRoute", () => {
  it("treats every point as an anchor when no record exists", () => {
    const draft = draftFromRoute([A, B, C], null);
    expect(draft.anchors).toEqual([A, B, C]);
    expect(draftPoints(draft)).toEqual([A, B, C]);
  });

  it("round-trips a snapped route back to its anchors", () => {
    const points = draftPoints(snapped);
    const indices = draftAnchorIndices(snapped);
    const restored = draftFromRoute(points, indices);
    expect(restored.anchors).toEqual([A, B]);
    expect(restored.filler).toEqual([fillAB]);
  });

  it("falls back to all-anchors on a corrupt record rather than throwing", () => {
    // Indices that don't start at 0, aren't ascending, or run off the end are
    // untrustworthy; every point being an anchor is the safe reading.
    for (const bad of [[1, 3], [0, 99], [3, 0], [0], [0, 1.5, 3]]) {
      const draft = draftFromRoute([A, ...fillAB, B], bad);
      expect(draft.anchors).toHaveLength(4);
    }
  });
});

describe("nearestSegment", () => {
  it("has nothing to report below two anchors", () => {
    expect(nearestSegment(appendAnchor(emptyDraft, A), A)).toBeNull();
  });

  it("picks the segment the point sits on", () => {
    const draft: RouteDraft = { anchors: [A, B, C], filler: [[], []] };
    expect(nearestSegment(draft, [150.005, -33])!.index).toBe(0);
    expect(nearestSegment(draft, [150.015, -33])!.index).toBe(1);
  });

  it("measures against the drawn line, including filler", () => {
    // The filler bulges south; a point near the bulge is close to the DRAWN
    // line even though it is far from the straight anchor-to-anchor chord.
    const near = nearestSegment(snapped, [150.0045, -33.001])!;
    expect(near.index).toBe(0);
    expect(near.distanceDegrees).toBeLessThan(0.0005);
  });
});

describe("reverseDraft", () => {
  it("agrees with the saved-route pair — points AND anchor indices", () => {
    // The invariant that matters: whichever shape you reverse in, the route on
    // the wire is the same. Reversing the draft and flattening must equal
    // flattening and reversing, anchors included.
    const draft: RouteDraft = { anchors: [A, B, C], filler: [fillAB, []] };
    const points = draftPoints(draft);
    const reversed = reverseDraft(draft);
    expect(draftPoints(reversed)).toEqual(reverseRoute(points));
    expect(draftAnchorIndices(reversed)).toEqual(
      reverseRouteAnchors(draftAnchorIndices(draft), points.length),
    );
  });

  it("keeps each snapped run with the segment it fills", () => {
    // Reversing the runs' order but not their contents (or the other way
    // round) still flattens to the right length, so only the geometry catches
    // it — the filler must come back between the same two anchors.
    const reversed = reverseDraft(snapped);
    expect(reversed.anchors).toEqual([B, A]);
    expect(reversed.filler).toEqual([[...fillAB].reverse()]);
  });

  it("is its own inverse", () => {
    const draft: RouteDraft = { anchors: [A, B, C], filler: [fillAB, []] };
    expect(reverseDraft(reverseDraft(draft))).toEqual(draft);
  });

  it("has nothing to do to an empty draft", () => {
    expect(reverseDraft(emptyDraft)).toEqual(emptyDraft);
  });
});
