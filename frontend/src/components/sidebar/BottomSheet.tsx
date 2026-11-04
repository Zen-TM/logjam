import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import classes from "./BottomSheet.module.css";
import { SheetSnapContext } from "./sheetSnap";
import { useViewport, type Viewport } from "./useViewport";

export type SheetSnap = "peek" | "half" | "full";

/** A place a drag can end. A sheet that can be closed has no peek: the floor
 *  is the edge of the screen. */
type Stop = SheetSnap | "closed";

const SNAP_LABELS: Record<SheetSnap, string> = {
  peek: "Peek",
  half: "Half height",
  full: "Full height",
};

const PEEK_REVEAL_PX = 96;
// Bottom nav strip height; the sheet sits above it. Keep in sync with
// --bottom-nav-height in index.css.
const NAV_HEIGHT_PX = 68;
// Fraction of viewport height revealed at the "half" snap: a bit under half, so
// the map stays the larger part of the screen behind a page.
const HALF_REVEAL_FRACTION = 0.45;
// A release this fast (px/ms) carries on as far as it would in this long, so a
// flick down closes the sheet without crossing the screen.
const FLING_PROJECTION_MS = 150;
// A finger still for this long before it lifts has no fling left.
const FLING_STALE_MS = 100;
// A finger moves a little before it means a drag; under this a pull is a tap
// or a scroll.
const PULL_SLOP_PX = 6;

/** The sheet's own height — it fills the viewport above the bottom nav strip. */
function sheetHeightPx(viewportHeight: number): number {
  return viewportHeight - NAV_HEIGHT_PX;
}

/** translateY (px from fully-open) for each stop, given the viewport. */
export function stopTranslate(
  stop: Stop,
  { height: viewportHeight, short }: Viewport,
  peekReveal: number,
): number {
  const sheetHeight = sheetHeightPx(viewportHeight);
  switch (stop) {
    case "full":
      return 0;
    case "half":
      return short ? 0 : sheetHeight - viewportHeight * HALF_REVEAL_FRACTION;
    case "peek":
      return sheetHeight - peekReveal;
    case "closed":
      return sheetHeight;
  }
}

/** Stop whose translate is nearest the given drag translate. */
export function nearestStop(
  translate: number,
  stops: readonly Stop[],
  viewport: Viewport,
  peekReveal: number,
): Stop {
  return stops.reduce((best, stop) =>
    Math.abs(stopTranslate(stop, viewport, peekReveal) - translate) <
    Math.abs(stopTranslate(best, viewport, peekReveal) - translate)
      ? stop
      : best,
  );
}

/** True when the touched element, or something it sits in below `root`, is
 *  scrolled away from its top: a pull down there is the page scrolling back. */
function scrolledWithin(target: EventTarget | null, root: HTMLElement) {
  for (let el = target as HTMLElement | null; el; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
    if (el === root) break;
  }
  return false;
}

/** Elements that keep their own touches: a field, a scrub chart, anything marked
 *  `data-no-sheet-drag`. A vertical drag on them is theirs, not the sheet's. */
function ownsTouch(target: EventTarget | null, root: HTMLElement) {
  for (let el = target as HTMLElement | null; el; el = el.parentElement) {
    if (
      el.matches(
        "input, textarea, select, [contenteditable], [data-no-sheet-drag]",
      ) ||
      getComputedStyle(el).touchAction === "none"
    )
      return true;
    if (el === root) break;
  }
  return false;
}

type Drag = {
  startY: number;
  base: number;
  translate: number;
  lastY: number;
  lastT: number;
  /** px/ms, down positive. */
  velocity: number;
};

/** Draggable bottom sheet for mobile panels. Controlled snap point so callers
 *  (App.tsx) can collapse it to "peek" during map-pick flows.
 *
 *  A user has two heights, half and full, and a way out: swiping down from half
 *  closes the sheet as its ✕ does (`onClose`). "Peek" is not one of them; it is
 *  where a map flow or a drawing tool holds the sheet (`peek`), so the map is
 *  there to press. A sheet with no `onClose` cannot be closed by a swipe, and
 *  its floor is the peek.
 *
 *  It is dragged by its grab bar, or by a finger pulling down anywhere on a
 *  page that is scrolled to its top, as Logjam GPS's sheets are.
 *
 *  It is the same COMPLEMENTARY LANDMARK the desktop panel is, named by the page
 *  it holds — a reader jumping by landmark should not lose the panel by being on
 *  a phone. Its grab bar is a `slider`, because a bar that only answers a drag
 *  is a control a keyboard cannot reach (WCAG 2.1.1). */
function BottomSheet({
  snap,
  onSnapChange,
  onClose,
  peek = false,
  title,
  peekReveal = PEEK_REVEAL_PX,
  children,
}: {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  /** What a swipe down past the lowest height does, and what Escape does.
   *  Absent where closing must not happen under the user: a tool whose ✕ asks
   *  first, or a map flow that has brought the sheet down. */
  onClose?: () => void;
  /** The peek is a height of this sheet: a drawing tool, or a map flow, keeps it
   *  low so the map is there to press. */
  peek?: boolean;
  /** The page's own title: the landmark's accessible name. */
  title: string;
  /** How much of the sheet shows at "peek", in px. The default is a title; a
   *  page that keeps a readout at its peek (a drawing tool) asks for more. */
  peekReveal?: number;
  children: ReactNode;
}) {
  const viewport = useViewport();
  const hasPeek = peek || snap === "peek";
  const stops: readonly Stop[] = [
    "full",
    "half",
    ...(hasPeek ? (["peek"] as const) : []),
    ...(onClose ? (["closed"] as const) : []),
  ];
  // Shortest first, so the index doubles as the slider's value: taller is more.
  const heights: readonly SheetSnap[] = hasPeek
    ? ["peek", "half", "full"]
    : ["half", "full"];
  const floor = stopTranslate(
    onClose ? "closed" : hasPeek ? "peek" : "half",
    viewport,
    peekReveal,
  );

  // Live drag translate in px; null when not dragging (snap drives transform).
  const [dragTranslate, setDragTranslate] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);

  // Measure the drag-handle height so the content region is sized exactly to
  // the visible area below it. Robust against padding/font changes.
  const handleRef = useRef<HTMLDivElement>(null);
  const [handleHeight, setHandleHeight] = useState(20); // safe initial guess
  useLayoutEffect(() => {
    if (handleRef.current) {
      setHandleHeight(handleRef.current.offsetHeight);
    }
  }, []);

  function begin(y: number) {
    const base = stopTranslate(snap, viewport, peekReveal);
    drag.current = {
      startY: y,
      base,
      translate: base,
      lastY: y,
      lastT: performance.now(),
      velocity: 0,
    };
    setDragTranslate(base);
  }

  function move(y: number) {
    const d = drag.current;
    if (!d) return;
    const time = performance.now();
    if (time > d.lastT) d.velocity = (y - d.lastY) / (time - d.lastT);
    d.lastY = y;
    d.lastT = time;
    d.translate = Math.min(Math.max(d.base + y - d.startY, 0), floor);
    setDragTranslate(d.translate);
  }

  /** An interruption (a call, a second finger, the notification shade) is not a
   *  release: the sheet goes back to where it was. */
  function cancel() {
    drag.current = null;
    setDragTranslate(null);
  }

  function end() {
    const d = drag.current;
    drag.current = null;
    setDragTranslate(null);
    if (!d) return;
    // A finger that stopped before it lifted is not a fling.
    const velocity =
      performance.now() - d.lastT > FLING_STALE_MS ? 0 : d.velocity;
    const projected = d.translate + velocity * FLING_PROJECTION_MS;
    const stop = nearestStop(projected, stops, viewport, peekReveal);
    if (stop === "closed") onClose?.();
    else onSnapChange(stop);
  }

  // A pull down on a page that is scrolled to its top. The listeners are native
  // and not passive: a React `onTouchMove` cannot cancel the browser's own
  // scroll, which would then fight the drag.
  const contentRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ begin, move, end, cancel });
  useLayoutEffect(() => {
    latest.current = { begin, move, end, cancel };
  });
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    let pull: { x: number; y: number; blocked: boolean } | null = null;
    let pulling = false;
    const onStart = (event: TouchEvent) => {
      // A second finger is a pinch or a palm, not a pull: a drag in progress
      // goes back to where it was.
      if (pulling) latest.current.cancel();
      pulling = false;
      const touch = event.touches[0];
      pull =
        event.touches.length === 1
          ? {
              x: touch.clientX,
              y: touch.clientY,
              blocked:
                scrolledWithin(event.target, root) ||
                ownsTouch(event.target, root),
            }
          : null;
    };
    const onMove = (event: TouchEvent) => {
      if (!pull) return;
      const touch = event.touches[0];
      if (!pulling) {
        if (pull.blocked) return;
        const dy = touch.clientY - pull.y;
        const dx = Math.abs(touch.clientX - pull.x);
        // Once a gesture has gone up, sideways, or scrolled the page, it is the
        // page's for good: coming back down past where it began must not start a
        // drag the browser is already scrolling under.
        if (
          dy < -PULL_SLOP_PX ||
          (dx > PULL_SLOP_PX && dx > dy) ||
          scrolledWithin(event.target, root)
        ) {
          pull.blocked = true;
          return;
        }
        if (dy < PULL_SLOP_PX) return;
        pulling = true;
        latest.current.begin(pull.y);
      }
      if (event.cancelable) event.preventDefault();
      latest.current.move(touch.clientY);
    };
    const onEnd = () => {
      if (pulling) latest.current.end();
      pull = null;
      pulling = false;
    };
    const onCancel = () => {
      if (pulling) latest.current.cancel();
      pull = null;
      pulling = false;
    };
    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd);
    root.addEventListener("touchcancel", onCancel);
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onCancel);
    };
  }, []);

  // Escape closes a sheet that can close, unless something inside took it: a
  // search clearing or a row selection (they preventDefault), a menu, a dialog.
  // React's handler, not a native one: it runs after the handlers below it, and
  // hears a portalled dialog's keys, which `closest` then recognises. The
  // keyboard's other way out is the ✕ in the page.
  function handleEscape(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || event.defaultPrevented || !onClose) return;
    if (
      (event.target as Element).closest(
        'input, textarea, select, [role="menu"], [role="dialog"], [role="listbox"]',
      )
    )
      return;
    event.preventDefault();
    onClose();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    begin(event.clientY);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = heights.indexOf(snap);
    const next = {
      ArrowUp: index + 1,
      ArrowRight: index + 1,
      ArrowDown: index - 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: heights.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const clamped = Math.min(Math.max(next, 0), heights.length - 1);
    if (clamped !== index) onSnapChange(heights[clamped]);
  }

  const translate = dragTranslate ?? stopTranslate(snap, viewport, peekReveal);

  // The sheet element is always full-height and slides down via translateY.
  // Size the content region to only the *visible* portion so overflow-y: auto
  // in the panel body scrolls within the on-screen area, not into the
  // off-screen lower half of the sheet.
  const visibleContentHeight = Math.max(
    0,
    sheetHeightPx(viewport.height) - translate - handleHeight,
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
      {/* The landmark only hears the keys of the controls inside it. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <aside
        className={classes.sheet}
        onKeyDown={handleEscape}
        aria-label={title}
        style={{
          transform: `translateY(${translate}px)`,
          transition: dragTranslate !== null ? "none" : undefined,
        }}
      >
        <div
          ref={handleRef}
          className={classes.handle}
          role="slider"
          tabIndex={0}
          aria-label="Panel height"
          aria-valuemin={0}
          aria-valuemax={heights.length - 1}
          aria-valuenow={heights.indexOf(snap)}
          aria-valuetext={SNAP_LABELS[snap]}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={(event) => move(event.clientY)}
          onPointerUp={end}
          onPointerCancel={cancel}
        >
          <div className={classes.grip} />
        </div>
        <div
          ref={contentRef}
          className={classes.content}
          style={{ height: visibleContentHeight }}
        >
          <SheetSnapContext.Provider value={snap}>
            {children}
          </SheetSnapContext.Provider>
        </div>
      </aside>
    </>
  );
}

export default BottomSheet;
