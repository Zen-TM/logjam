import { sheetPins } from "./sheetPull";

/**
 * The pin on one list, fed by its scroll view's events. The list's refresh is
 * held off (its control disabled) for as long as the list is scrolled away
 * from its top, and for the rest of any drag that has been away from it. Held
 * only from the first touch would be too late: Android's refresh layout takes
 * a touch it was enabled for at the moment the finger went down, and keeps it
 * (through the scroll view's nested scroll) even if it is disabled a moment
 * later, so a drag that starts scrolled down would still refresh on reaching
 * the top. Android also sends JS a touch CANCEL when the scroll view takes a
 * drag over, and then no touch end, so a cancel decides nothing: a finger is
 * down from `down` or `beginDrag` until `endDrag` or `up`.
 * Held off, the control is disabled; `subscribe` tells whoever draws it.
 * Same rule as a sheet's pull-down (`sheetPins`).
 * Guard: `refreshPin.test.ts`.
 */
export function createRefreshPin() {
  const s = { scrolled: 0, touching: false, pinned: false, left: false };
  const listeners = new Set<() => void>();
  const set = (pinned: boolean) => {
    if (pinned === s.pinned) return;
    s.pinned = pinned;
    for (const listener of listeners) listener();
  };
  // Away from the top: held. At the top: held only while a finger that has
  // been down since before it got there is still down.
  const settle = () => set(s.touching ? s.pinned : sheetPins(s));
  return {
    held: () => s.pinned,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    // Whether the drag that is down, or the last one, left the top. Android's
    // refresh layout may have armed at the finger landing, while the control
    // was still enabled, and disabling it later does not stop that pull: the
    // refresh it asks for is dropped (`PullRefreshControl`). Kept past the
    // finger lifting, as the refresh is reported after it; the next finger
    // down starts afresh.
    leftTop: () => s.left,
    down: () => {
      s.touching = true;
      s.left = sheetPins(s);
      set(sheetPins(s));
    },
    scroll: (scrolled: number) => {
      s.scrolled = scrolled;
      if (sheetPins(s) && s.touching) s.left = true;
      if (sheetPins(s)) set(true);
      else settle();
    },
    beginDrag: () => {
      s.touching = true;
    },
    endDrag: () => {
      s.touching = false;
      set(sheetPins(s));
    },
    // A finger that never became a drag (a tap).
    up: () => {
      s.touching = false;
      set(sheetPins(s));
    },
  };
}
