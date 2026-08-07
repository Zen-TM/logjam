// Draft state for the route draw/edit tool, with undo.
//
// The draft model itself is in @logjam/shared (routeDraft.ts) so web and mobile
// agree on what an anchor is. This hook adds the one thing a UI needs on top:
// a history, so Undo means "take back my last action" rather than "delete one
// vertex".
//
// Undo is a stack of whole drafts rather than a list of inverse operations. A
// draft is a handful of coordinate pairs, so snapshotting one costs nothing,
// and it makes every action undoable — including a snapped run arriving, a
// vertex drag, and a mid-line insert — without writing an inverse for each.
import { useCallback, useMemo, useRef, useState } from "react";
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
  setFiller,
  type RouteDraft,
  type RoutePoint,
  MAX_ROUTE_POINTS,
} from "@logjam/shared";

/** Deepest undo stack. Far past what anyone reaches for, and bounded so a long
 *  drawing session can't grow without limit. */
const MAX_HISTORY = 100;

export type RouteDraftHandle = {
  draft: RouteDraft;
  /** Full geometry, for drawing and saving. */
  points: RoutePoint[];
  /** Which of `points` are the user's own vertices — the draggable handles. */
  anchorIndices: number[];
  canUndo: boolean;
  atCap: boolean;
  addAnchor: (point: RoutePoint) => void;
  /** Attach a snapped run; no-op if its segment has since changed. */
  applySnap: (from: RoutePoint, to: RoutePoint, between: RoutePoint[]) => void;
  moveAnchorAt: (index: number, point: RoutePoint) => void;
  deleteAnchorAt: (index: number) => void;
  insertAnchorAt: (segmentIndex: number, point: RoutePoint) => void;
  undo: () => void;
  reset: (
    route?: { points: RoutePoint[]; anchors?: number[] | null } | null,
  ) => void;
};

export function useRouteDraft(): RouteDraftHandle {
  const [draft, setDraft] = useState<RouteDraft>(emptyDraft);
  const history = useRef<RouteDraft[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  /** Every mutating action goes through here, so history is never forgotten. */
  const commit = useCallback((next: (current: RouteDraft) => RouteDraft) => {
    setDraft((current) => {
      const updated = next(current);
      // A no-op action must not consume an undo step — otherwise pressing
      // Undo appears to do nothing.
      if (updated === current) return current;
      history.current = [...history.current, current].slice(-MAX_HISTORY);
      setCanUndo(true);
      return updated;
    });
  }, []);

  const undo = useCallback(() => {
    setDraft((current) => {
      const previous = history.current[history.current.length - 1];
      if (!previous) return current;
      history.current = history.current.slice(0, -1);
      setCanUndo(history.current.length > 0);
      return previous;
    });
  }, []);

  const reset = useCallback(
    (route?: { points: RoutePoint[]; anchors?: number[] | null } | null) => {
      history.current = [];
      setCanUndo(false);
      setDraft(route ? draftFromRoute(route.points, route.anchors) : emptyDraft);
    },
    [],
  );

  const points = useMemo(() => draftPoints(draft), [draft]);
  const anchorIndices = useMemo(() => draftAnchorIndices(draft), [draft]);

  return {
    draft,
    points,
    anchorIndices,
    canUndo,
    atCap: draftPointCount(draft) >= MAX_ROUTE_POINTS,
    addAnchor: useCallback(
      (point: RoutePoint) =>
        commit((current) =>
          draftPointCount(current) >= MAX_ROUTE_POINTS
            ? current
            : appendAnchor(current, point),
        ),
      [commit],
    ),
    // Deliberately NOT through `commit`: a snapped run arriving is not
    // something the user did, so it must not consume an undo step. Undo after
    // "click, click, snap lands" should take back the click — not silently
    // straighten the line and leave the point where it was.
    applySnap: useCallback(
      (from: RoutePoint, to: RoutePoint, between: RoutePoint[]) =>
        setDraft((current) => {
          const updated = setFiller(current, from, to, between);
          // Refuse a snap that would blow the point cap: the straight segment
          // already drawn is a fine answer, and truncating a snapped run
          // mid-track would leave the line ending nowhere.
          return draftPointCount(updated) > MAX_ROUTE_POINTS ? current : updated;
        }),
      [],
    ),
    moveAnchorAt: useCallback(
      (index: number, point: RoutePoint) =>
        commit((current) => moveAnchor(current, index, point)),
      [commit],
    ),
    deleteAnchorAt: useCallback(
      (index: number) => commit((current) => deleteAnchor(current, index)),
      [commit],
    ),
    insertAnchorAt: useCallback(
      (segmentIndex: number, point: RoutePoint) =>
        commit((current) => insertAnchor(current, segmentIndex, point)),
      [commit],
    ),
    undo,
    reset,
  };
}
