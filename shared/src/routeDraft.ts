// The in-progress route: what the user placed, and what snapping filled in.
//
// A drawn route has two kinds of vertex and they must not be confused. ANCHORS
// are the points the user actually put down — draggable, deletable, the thing
// they think of as "my points". FILLER is the run of vertices snapping added to
// follow a track between two anchors; it is geometry, not intent, and the user
// should never have to edit or undo it a vertex at a time.
//
// Keeping them apart here is what lets a snapped route read as one contiguous
// line while still being an ordinary point list on the wire. `points` stays the
// single geometric truth; `anchors` is recorded alongside as INDICES into it,
// so an older route with no anchor record simply means "every point is an
// anchor" and nothing needs migrating.
//
// PRIVACY: these are wilderness coordinates. Nothing here logs.

import type { RoutePoint } from "./routeValidation.js";

export type RouteDraft = {
  /** The user's own vertices, in order. */
  anchors: RoutePoint[];
  /**
   * filler[i] holds the snapped vertices strictly between anchors[i] and
   * anchors[i + 1] — empty for a straight segment. Always anchors.length - 1
   * long once there are two anchors, so a segment's filler is addressable by
   * the index of the anchor that starts it.
   */
  filler: RoutePoint[][];
};

export const emptyDraft: RouteDraft = { anchors: [], filler: [] };

/** The full geometry, which is what gets saved and drawn. */
export function draftPoints(draft: RouteDraft): RoutePoint[] {
  const points: RoutePoint[] = [];
  draft.anchors.forEach((anchor, i) => {
    points.push(anchor);
    if (i < draft.anchors.length - 1) {
      for (const point of draft.filler[i] ?? []) points.push(point);
    }
  });
  return points;
}

/** Positions of the anchors within `draftPoints` — the persisted form. */
export function draftAnchorIndices(draft: RouteDraft): number[] {
  const indices: number[] = [];
  let cursor = 0;
  draft.anchors.forEach((_, i) => {
    indices.push(cursor);
    cursor += 1 + (i < draft.anchors.length - 1 ? (draft.filler[i]?.length ?? 0) : 0);
  });
  return indices;
}

/** Total vertices the draft would save as — for the MAX_ROUTE_POINTS check. */
export function draftPointCount(draft: RouteDraft): number {
  return (
    draft.anchors.length +
    draft.filler.reduce((total, run) => total + run.length, 0)
  );
}

/**
 * Rebuild a draft from a saved route.
 *
 * `anchorIndices` null (or unusable) means every point is an anchor, which is
 * how routes drawn before snapping existed behave — and the honest reading,
 * since without a record we cannot tell which vertices the user chose.
 */
export function draftFromRoute(
  points: readonly RoutePoint[],
  anchorIndices: readonly number[] | null | undefined,
): RouteDraft {
  const usable =
    anchorIndices != null &&
    anchorIndices.length >= 2 &&
    anchorIndices[0] === 0 &&
    anchorIndices[anchorIndices.length - 1] === points.length - 1 &&
    anchorIndices.every(
      (value, i) =>
        Number.isInteger(value) &&
        value >= 0 &&
        value < points.length &&
        (i === 0 || value > anchorIndices[i - 1]!),
    );

  if (!usable) {
    return { anchors: points.map((p) => p), filler: points.map(() => []).slice(1) };
  }

  const anchors: RoutePoint[] = [];
  const filler: RoutePoint[][] = [];
  anchorIndices.forEach((index, i) => {
    anchors.push(points[index]!);
    if (i < anchorIndices.length - 1) {
      filler.push(points.slice(index + 1, anchorIndices[i + 1]!) as RoutePoint[]);
    }
  });
  return { anchors, filler };
}

/** Add a vertex at the end, with no filler behind it yet. */
export function appendAnchor(draft: RouteDraft, point: RoutePoint): RouteDraft {
  return {
    anchors: [...draft.anchors, point],
    filler: draft.anchors.length === 0 ? [] : [...draft.filler, []],
  };
}

/**
 * Attach a snapped run to the segment starting at `index`.
 *
 * Guarded by the anchors it was computed for: snapping is asynchronous, and by
 * the time a run comes back the user may have undone, moved or deleted the
 * points it belongs between. Applying it then would staple a track onto a
 * segment that no longer exists.
 */
export function setFiller(
  draft: RouteDraft,
  from: RoutePoint,
  to: RoutePoint,
  points: readonly RoutePoint[],
): RouteDraft {
  const index = draft.anchors.findIndex(
    (anchor, i) =>
      samePoint(anchor, from) && samePoint(draft.anchors[i + 1], to),
  );
  if (index === -1) return draft;
  const filler = [...draft.filler];
  filler[index] = points.map((p) => p);
  return { ...draft, filler };
}

function samePoint(a: RoutePoint | undefined, b: RoutePoint | undefined): boolean {
  return a != null && b != null && a[0] === b[0] && a[1] === b[1];
}

/**
 * Move an anchor.
 *
 * Both segments touching it lose their filler: that geometry followed a track
 * between the OLD position and its neighbours, and keeping it would leave the
 * line running to where the point used to be. Straight is the honest fallback,
 * and the caller can re-snap.
 */
export function moveAnchor(
  draft: RouteDraft,
  index: number,
  point: RoutePoint,
): RouteDraft {
  if (index < 0 || index >= draft.anchors.length) return draft;
  const anchors = [...draft.anchors];
  anchors[index] = point;
  const filler = [...draft.filler];
  if (index > 0) filler[index - 1] = [];
  if (index < filler.length) filler[index] = [];
  return { anchors, filler };
}

/**
 * Remove an anchor, joining its neighbours directly. The joined segment starts
 * straight for the same reason as moveAnchor.
 */
export function deleteAnchor(draft: RouteDraft, index: number): RouteDraft {
  if (index < 0 || index >= draft.anchors.length) return draft;
  const anchors = draft.anchors.filter((_, i) => i !== index);
  if (anchors.length < 2) return { anchors, filler: [] };

  const filler = [...draft.filler];
  if (index === 0) filler.shift();
  else if (index === draft.anchors.length - 1) filler.pop();
  else {
    // Two segments become one; it has no snapped geometry of its own yet.
    filler.splice(index - 1, 2, []);
  }
  return { anchors, filler };
}

/**
 * Insert an anchor into the segment starting at `index` — the drag-the-line
 * gesture. Splits the segment, and both halves start straight.
 */
export function insertAnchor(
  draft: RouteDraft,
  index: number,
  point: RoutePoint,
): RouteDraft {
  if (index < 0 || index >= draft.anchors.length - 1) return draft;
  const anchors = [...draft.anchors];
  anchors.splice(index + 1, 0, point);
  const filler = [...draft.filler];
  filler.splice(index, 1, [], []);
  return { anchors, filler };
}

/**
 * Which segment a position lies nearest, and how far off it is — for deciding
 * where a line-drag inserts. Returns null when the draft has no segment.
 *
 * Compares against the DRAWN geometry (filler included), because that is the
 * line the user is pointing at, but reports the ANCHOR segment index, because
 * that is what an insert splits.
 */
export function nearestSegment(
  draft: RouteDraft,
  point: RoutePoint,
): { index: number; distanceDegrees: number } | null {
  if (draft.anchors.length < 2) return null;
  let best: { index: number; distanceDegrees: number } | null = null;
  for (let i = 0; i < draft.anchors.length - 1; i++) {
    const run = [
      draft.anchors[i]!,
      ...(draft.filler[i] ?? []),
      draft.anchors[i + 1]!,
    ];
    for (let j = 1; j < run.length; j++) {
      const distance = distanceToSegment(point, run[j - 1]!, run[j]!);
      if (!best || distance < best.distanceDegrees) {
        best = { index: i, distanceDegrees: distance };
      }
    }
  }
  return best;
}

/**
 * Point-to-segment distance in DEGREES, not metres: callers compare it against
 * a pixel-derived threshold they convert themselves, and the longitude
 * distortion over a few screen pixels is irrelevant.
 */
function distanceToSegment(
  point: RoutePoint,
  start: RoutePoint,
  end: RoutePoint,
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
  );
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dy * t));
}

/**
 * Reverse a whole draft — the direction flip applied to work in progress.
 *
 * `reverseRoute` / `reverseRouteAnchors` (routeValidation.ts) reverse a SAVED
 * route: a point list plus the indices of the user's own vertices within it. A
 * draft holds the same information in the other shape — anchors as points, with
 * each snapped run kept beside the segment it fills — so reversing one means
 * reversing the anchors, reversing the ORDER of the runs (run i sits between
 * anchors i and i+1, and that pairing has to survive), and reversing each run
 * internally.
 *
 * Equivalent to the saved-route pair by construction, and pinned as such in the
 * test: reversing the draft then flattening gives the same points and the same
 * anchor indices as flattening then reversing. Anything less remaps which
 * vertices count as the user's, which is the whole reason reverseRouteAnchors
 * exists.
 */
export function reverseDraft(draft: RouteDraft): RouteDraft {
  return {
    anchors: [...draft.anchors].reverse(),
    filler: draft.filler.map((run) => [...run].reverse()).reverse(),
  };
}
