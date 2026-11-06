import { useEffect, type RefObject } from "react";
import { useEscape } from "./useEscape";

// The way in and out of a page inside a panel (frontend/DESIGN.md): focus goes
// to the back arrow on the way in and to the row that was opened on the way
// out, and Escape is the back arrow. A page that draws a `Hero` with `onBack`
// has an arrow, so this reads the DOM and every such page joins with no wiring,
// whether it is a panel of its own (a place) or a step inside one (a Settings
// page, the leaderboard).

const BACK = "header[data-back] > button";
const ROW_OPEN = "[data-row-open]";

// How long after a page swap a lost focus is put back.
const ARRIVAL_MS = 1500;

type Remembered = { index: number; text: string };

const backIn = (root: Element) => root.querySelector<HTMLElement>(BACK);

const lost = () =>
  document.activeElement == null || document.activeElement === document.body;

/** The row that held focus last, found again: the same title if it is still
 *  listed, else the one now in its place (the next row after a delete). */
function rowAfter(root: Element, { index, text }: Remembered) {
  const opens = Array.from(root.querySelectorAll<HTMLElement>(ROW_OPEN));
  return (
    (opens[index]?.textContent === text ? opens[index] : undefined) ??
    opens.find((open) => open.textContent === text) ??
    opens[Math.min(index, opens.length - 1)]
  );
}

export function usePanelFocus(rootRef: RefObject<HTMLElement | null>) {
  useEscape(rootRef, () => {
    const root = rootRef.current;
    const back = root && backIn(root);
    // Escape in a field is the field's own; on a page with no arrow there is
    // no layer to undo.
    if (!back || document.activeElement?.closest("input, textarea, select"))
      return false;
    back.click();
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // The row last focused on a root page (one with no back arrow), which the
    // way back returns to.
    let remembered: Remembered | null = null;
    let depth = backIn(root) ? 1 : 0;

    const onFocusIn = (event: FocusEvent) => {
      const open = (event.target as Element)
        .closest("[data-row]")
        ?.querySelector<HTMLElement>(ROW_OPEN);
      if (!open) return;
      const opens = Array.from(root.querySelectorAll(ROW_OPEN));
      if (backIn(root)) return;
      remembered = { index: opens.indexOf(open), text: open.textContent ?? "" };
    };

    // Only a page that swapped, and only when the swap took focus with it (the
    // row or the arrow that held it is gone): a click on the rail or the map
    // keeps its own.
    const place = (page: number) => {
      const target =
        page === 1 ? backIn(root) : remembered && rowAfter(root, remembered);
      target?.focus();
      return target != null;
    };
    let arriving = 0; // until when a lost focus is put back (ms)
    const observer = new MutationObserver(() => {
      const next = backIn(root) ? 1 : 0;
      if (next !== depth) {
        depth = next;
        arriving = performance.now() + ARRIVAL_MS;
        // A confirm that caused the swap (Delete) is still closing: wait it out.
        const settle = (frames: number) =>
          requestAnimationFrame(() => {
            if (!lost()) {
              if (frames > 0 && document.querySelector("dialog[open]"))
                settle(frames - 1);
              return;
            }
            if (place(next)) return;
            if (frames > 0) settle(frames - 1);
            else {
              // No row to go back to (the list is empty): its title.
              const title = root.querySelector<HTMLElement>("header h2");
              if (title) {
                title.tabIndex = -1;
                title.focus();
              }
            }
          });
        settle(60);
      } else if (performance.now() < arriving) {
        // The list is still arriving: a delete refetches it, and the row that
        // took focus may be the one that goes.
        requestAnimationFrame(() => lost() && place(next));
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener("focusin", onFocusIn);
    return () => {
      observer.disconnect();
      root.removeEventListener("focusin", onFocusIn);
    };
  }, [rootRef]);
}
