import { sheetPins } from "./sheetPull";

/**
 * Whether a list's pull-to-refresh is held off after `event`. The same rule as
 * a sheet's pull-down (`sheetPins`): a finger that goes down on a list
 * scrolled away from its top, or scrolls it away mid-drag, never arms the
 * refresh; the drag scrolls and stops at the top. Lifting the finger ends it.
 * Guard: `refreshPin.test.ts`.
 */
export function refreshPinAfter(
  event: "down" | "scroll" | "up",
  { pinned, scrolled }: { pinned: boolean; scrolled: number },
): boolean {
  if (event === "up") return false;
  if (event === "down") return sheetPins({ scrolled });
  return pinned || sheetPins({ scrolled });
}

/**
 * The pin on one list, fed by its scroll view's events. Android sends JS a
 * touch CANCEL when the scroll view takes a drag over, and then no touch end,
 * so a cancel decides nothing: the drag is bracketed by `beginDrag` and
 * `endDrag` instead, as `BottomSheet` does. Only scrolling inside a drag can
 * pin a drag that began at the top; momentum after the finger is up cannot.
 * Held off, the control is disabled; `subscribe` tells whoever draws it.
 * Guard: `refreshPin.test.ts`.
 */
export function createRefreshPin() {
  const s = { scrolled: 0, dragging: false, pinned: false };
  const listeners = new Set<() => void>();
  const set = (pinned: boolean) => {
    if (pinned === s.pinned) return;
    s.pinned = pinned;
    for (const listener of listeners) listener();
  };
  return {
    held: () => s.pinned,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    down: () => set(refreshPinAfter("down", s)),
    scroll: (scrolled: number) => {
      s.scrolled = scrolled;
      if (s.dragging) set(refreshPinAfter("scroll", s));
    },
    beginDrag: () => {
      s.dragging = true;
    },
    endDrag: () => {
      s.dragging = false;
      set(refreshPinAfter("up", s));
    },
    // A finger that never became a drag (a tap).
    up: () => set(refreshPinAfter("up", s)),
  };
}
