import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

/** Track window.innerHeight reactively (orientation change, address-bar toggle). */
function useViewportHeight(): number {
  const [vh, setVh] = useState(() =>
    typeof window === "undefined" ? 800 : window.innerHeight,
  );
  useEffect(() => {
    function onResize() {
      setVh(window.innerHeight);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return vh;
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
  const viewportHeight = useViewportHeight();

  // Live drag translate in px; null when not dragging (snap drives transform).
  const [dragTranslate, setDragTranslate] = useState<number | null>(null);
  const dragStart = useRef<{ pointerY: number; baseTranslate: number } | null>(null);

  // Measure the drag-handle height so the content region is sized exactly to
  // the visible area below it. Robust against padding/font changes.
  const handleRef = useRef<HTMLDivElement>(null);
  const [handleHeight, setHandleHeight] = useState(20); // safe initial guess
  useLayoutEffect(() => {
    if (handleRef.current) {
      setHandleHeight(handleRef.current.offsetHeight);
    }
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = {
      pointerY: event.clientY,
      baseTranslate: snapTranslate(snap, viewportHeight),
    };
    setDragTranslate(snapTranslate(snap, viewportHeight));
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const delta = event.clientY - dragStart.current.pointerY;
    const maxTranslate = sheetHeightPx(viewportHeight) - PEEK_REVEAL_PX;
    const next = Math.min(Math.max(dragStart.current.baseTranslate + delta, 0), maxTranslate);
    setDragTranslate(next);
  }

  function handlePointerUp() {
    if (dragTranslate !== null) {
      onSnapChange(nearestSnap(dragTranslate, viewportHeight));
    }
    dragStart.current = null;
    setDragTranslate(null);
  }

  const translate = dragTranslate ?? snapTranslate(snap, viewportHeight);

  // The sheet element is always full-height and slides down via translateY.
  // Size the content region to only the *visible* portion so overflow-y: auto
  // in the panel body scrolls within the on-screen area, not into the
  // off-screen lower half of the sheet.
  const visibleContentHeight = Math.max(
    0,
    sheetHeightPx(viewportHeight) - translate - handleHeight,
  );

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
          ref={handleRef}
          className={classes.handle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className={classes.grip} />
        </div>
        <div className={classes.content} style={{ height: visibleContentHeight }}>
          {children}
        </div>
      </div>
    </>
  );
}

export default BottomSheet;
