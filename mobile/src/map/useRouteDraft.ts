// Draft state for the route draw/edit tool, with undo.
//
// Deliberately a near-copy of frontend/src/components/routes/useRouteDraft.ts.
// The part worth sharing — what an anchor is, and every operation on a draft —
// already lives in @logjam/shared (routeDraft.ts) and IS shared. What is
// duplicated here is only the thin React wrapper around it, because `shared/`
// is React-free by design and adding React to it to save fifty lines would be a
// bad trade. If the two drift, the shared module is the one that matters.
//
// Undo is a stack of whole drafts rather than inverse operations: a draft is a
// handful of coordinate pairs, so snapshotting one is free, and it makes every
// action undoable without writing an inverse for each.
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
  MAX_ROUTE_POINTS,
  type RouteDraft,
  type RoutePoint,
} from "@logjam/shared";

const MAX_HISTORY = 100;

export type RouteDraftHandle = {
  draft: RouteDraft | null;
  /** Full geometry, for drawing and saving. Empty when the tool is closed.
   *  Reflects an in-flight anchor drag, so the line follows the finger. */
  points: RoutePoint[];
  /** The user's own vertices — the draggable handles. */
  anchors: RoutePoint[];
  canUndo: boolean;
  atCap: boolean;
  /** True while the tool is armed, even with nothing drawn yet. */
  active: boolean;
  open: (route?: { points: RoutePoint[]; anchors?: number[] | null }) => void;
  close: () => void;
  addAnchor: (point: RoutePoint) => void;
  applySnap: (from: RoutePoint, to: RoutePoint, between: RoutePoint[]) => void;
  /** Where a drag currently has an anchor — drawn, not committed. */
  previewAnchorAt: (index: number, point: RoutePoint) => void;
  moveAnchorAt: (index: number, point: RoutePoint) => void;
  deleteAnchorAt: (index: number) => void;
  insertAnchorAt: (segmentIndex: number, point: RoutePoint) => void;
  clear: () => void;
  undo: () => void;
  /** Anchor indices to persist alongside `points`. */
  anchorIndices: () => number[];
};

export function useRouteDraft(): RouteDraftHandle {
  // Null means the tool is closed, which is distinct from an empty draft.
  const [draft, setDraft] = useState<RouteDraft | null>(null);
  const history = useRef<RouteDraft[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  // Where a drag has the anchor RIGHT NOW. Kept apart from the draft so a
  // gesture at frame rate neither fills the undo stack nor rewrites the
  // persisted draft sixty times a second; the drop commits it once.
  // ponytail: it is still screen state, so a drag re-renders the map screen per
  // frame (the cost DESIGN.md's scale bar avoids with a ref). Move it to a ref
  // + imperative shape update if a long route drags roughly.
  const [dragging, setDragging] = useState<{
    index: number;
    point: RoutePoint;
  } | null>(null);

  const commit = useCallback(
    (next: (current: RouteDraft) => RouteDraft) => {
      setDraft((current) => {
        if (!current) return current;
        const updated = next(current);
        // A no-op must not consume an undo step, or Undo appears to do nothing.
        if (updated === current) return current;
        history.current = [...history.current, current].slice(-MAX_HISTORY);
        setCanUndo(true);
        return updated;
      });
    },
    [],
  );

  const open = useCallback(
    (route?: { points: RoutePoint[]; anchors?: number[] | null }) => {
      history.current = [];
      setCanUndo(false);
      setDragging(null);
      setDraft(route ? draftFromRoute(route.points, route.anchors) : emptyDraft);
    },
    [],
  );

  const close = useCallback(() => {
    history.current = [];
    setCanUndo(false);
    setDragging(null);
    setDraft(null);
  }, []);

  // What is DRAWN: the committed draft with any live drag applied on top.
  const shown = useMemo(
    () => (draft && dragging ? moveAnchor(draft, dragging.index, dragging.point) : draft),
    [draft, dragging],
  );
  const points = useMemo(() => (shown ? draftPoints(shown) : []), [shown]);

  return {
    draft,
    points,
    // COMMITTED positions, deliberately: the handles are native annotations
    // that move themselves under the finger, and rewriting the coordinate of
    // the one being dragged fights the gesture.
    anchors: draft?.anchors ?? [],
    canUndo,
    atCap: draft ? draftPointCount(draft) >= MAX_ROUTE_POINTS : false,
    active: draft !== null,
    open,
    close,
    addAnchor: useCallback(
      (point: RoutePoint) =>
        commit((current) =>
          draftPointCount(current) >= MAX_ROUTE_POINTS
            ? current
            : appendAnchor(current, point),
        ),
      [commit],
    ),
    // NOT through `commit`: a snapped run arriving is not something the user
    // did, so it must not consume an undo step. Undo after "tap, tap, snap
    // lands" takes back the tap.
    applySnap: useCallback(
      (from: RoutePoint, to: RoutePoint, between: RoutePoint[]) =>
        setDraft((current) => {
          if (!current) return current;
          const updated = setFiller(current, from, to, between);
          // Refuse a snap that would blow the cap; the straight segment already
          // drawn is a fine answer, and a truncated run would end nowhere.
          return draftPointCount(updated) > MAX_ROUTE_POINTS ? current : updated;
        }),
      [],
    ),
    previewAnchorAt: useCallback(
      (index: number, point: RoutePoint) => setDragging({ index, point }),
      [],
    ),
    moveAnchorAt: useCallback(
      (index: number, point: RoutePoint) => {
        setDragging(null);
        commit((current) => moveAnchor(current, index, point));
      },
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
    clear: useCallback(() => commit(() => emptyDraft), [commit]),
    undo: useCallback(() => {
      setDraft((current) => {
        const previous = history.current[history.current.length - 1];
        if (!previous) return current;
        history.current = history.current.slice(0, -1);
        setCanUndo(history.current.length > 0);
        return previous;
      });
    }, []),
    anchorIndices: useCallback(
      () => (draft ? draftAnchorIndices(draft) : []),
      [draft],
    ),
  };
}
