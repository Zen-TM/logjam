import { useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import classes from "./BottomSheet.module.css";

export type SheetSnap = "peek" | "half" | "full";

const PEEK_REVEAL_PX = 96;
// Bottom nav strip height; the sheet sits above it. Keep in sync with
// --bottom-nav-height in index.css.
const NAV_HEIGHT_PX = 56;

/** The sheet's own height — it fills the viewport above the bottom nav strip. */
function sheetHeightPx(viewportHeight: number): number {
  return viewportHeight - NAV_HEIGHT_PX;
}

/** translateY (px from fully-open) for each snap point, given the viewport height. */
function snapTranslate(snap: SheetSnap, viewportHeight: number): number {
  const sheetHeight = sheetHeightPx(viewportHeight);
  switch (snap) {
    case "full":
      return 0;
    case "half":
      return sheetHeight - viewportHeight * 0.5;
    case "peek":
      return sheetHeight - PEEK_REVEAL_PX;
  }
}

/** Snap point whose translate is nearest the given drag translate. */
function nearestSnap(translate: number, viewportHeight: number): SheetSnap {
  const snaps: SheetSnap[] = ["full", "half", "peek"];
  return snaps.reduce((best, snap) =>
    Math.abs(snapTranslate(snap, viewportHeight) - translate) <
    Math.abs(snapTranslate(best, viewportHeight) - translate)
      ? snap
      : best,
  );
}

/** Draggable bottom sheet for mobile panels. Controlled snap point so callers
 *  (App.tsx) can collapse it to "peek" during map-pick flows. */
function BottomSheet({
  snap,
  onSnapChange,
  children,
}: {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  children: ReactNode;
}) {
  // Live drag translate in px; null when not dragging (snap drives transform).
  const [dragTranslate, setDragTranslate] = useState<number | null>(null);
  const dragStart = useRef<{ pointerY: number; baseTranslate: number } | null>(null);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = {
      pointerY: event.clientY,
      baseTranslate: snapTranslate(snap, window.innerHeight),
    };
    setDragTranslate(snapTranslate(snap, window.innerHeight));
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const delta = event.clientY - dragStart.current.pointerY;
    const maxTranslate = sheetHeightPx(window.innerHeight) - PEEK_REVEAL_PX;
    const next = Math.min(Math.max(dragStart.current.baseTranslate + delta, 0), maxTranslate);
    setDragTranslate(next);
  }

  function handlePointerUp() {
    if (dragTranslate !== null) {
      onSnapChange(nearestSnap(dragTranslate, window.innerHeight));
    }
    dragStart.current = null;
    setDragTranslate(null);
  }

  const translate =
    dragTranslate ?? snapTranslate(snap, typeof window === "undefined" ? 800 : window.innerHeight);

  return (
    <>
      {snap === "full" && dragTranslate === null && (
        <button
          className={classes.backdrop}
          aria-label="Collapse panel"
          onClick={() => onSnapChange("half")}
        />
      )}
      <div
        className={classes.sheet}
        style={{
          transform: `translateY(${translate}px)`,
          transition: dragTranslate !== null ? "none" : undefined,
        }}
      >
        <div
          className={classes.handle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className={classes.grip} />
        </div>
        <div className={classes.content}>{children}</div>
      </div>
    </>
  );
}

export default BottomSheet;
