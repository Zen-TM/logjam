import { useEffect, type RefObject } from "react";
import { nextEnabledIndex } from "./rovingFocus";

// A list of `Row`s is ONE tab stop (WAI-ARIA's roving tabindex): the row that
// last had focus keeps its title in the Tab order, and Up/Down, Home and End
// move between rows. The row's other controls stay reachable by key rather than
// by Tab: Space ticks its tile (Shift+Space a range), Enter opens it, and
// Shift+F10 or the context-menu key opens its actions. Controls a row carries
// for another reason (an Accept button) stay in the Tab order.
//
// It reads the DOM rather than taking a list, so every page's rows join with no
// wiring: a "list" is the rows that share a parent. The attributes it reads are
// set by `Row` (`data-row`, `data-row-open`).

const ROW = "[data-row]";
const OPEN = "[data-row-open]";
const TILE = '[role="checkbox"]';
const ACTIONS = '[aria-haspopup="menu"]';

const rowsOf = (group: Element) =>
  Array.from(group.children).filter(
    (child): child is HTMLElement =>
      child.matches(ROW) && child.querySelector(OPEN) != null,
  );

const openOf = (row: Element) => row.querySelector<HTMLElement>(OPEN);

const isEnabled = (row: HTMLElement) => !openOf(row)?.hasAttribute("disabled");

export function useListKeys(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // The row each list last put focus in, so a re-render keeps its tab stop.
    const current = new WeakMap<Element, Element>();

    const sync = () => {
      const groups = new Set<Element>();
      for (const open of root.querySelectorAll(OPEN)) {
        const row = open.closest(ROW);
        if (row?.parentElement) groups.add(row.parentElement);
      }
      for (const group of groups) {
        const rows = rowsOf(group);
        const stop =
          rows.find((row) => row === current.get(group) && isEnabled(row)) ??
          rows.find(isEnabled);
        for (const row of rows) {
          const keep = row === stop ? openOf(row) : null;
          for (const control of row.querySelectorAll<HTMLElement>(
            `${OPEN}, ${TILE}, ${ACTIONS}`,
          )) {
            if (control.closest('[role="menu"]')) continue;
            if (control === keep) control.removeAttribute("tabindex");
            else control.tabIndex = -1;
          }
        }
      }
    };

    let queued = false;
    const syncSoon = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        sync();
      });
    };
    sync();
    // Rows come and go with search, filters and refetches. Only the tree is
    // watched, so setting tabindex below does not trigger another pass.
    const observer = new MutationObserver(syncSoon);
    observer.observe(root, { childList: true, subtree: true });

    const onFocusIn = (event: FocusEvent) => {
      const row = (event.target as Element).closest(ROW);
      if (!row?.parentElement || !openOf(row)) return;
      current.set(row.parentElement, row);
      syncSoon();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>(ROW);
      if (!row?.parentElement || !openOf(row)) return;
      if (target.closest('input, textarea, select, [role="menu"]')) return;

      if (
        event.key === "ContextMenu" ||
        (event.key === "F10" && event.shiftKey)
      ) {
        const actions = row.querySelector<HTMLElement>(ACTIONS);
        if (!actions) return;
        event.preventDefault();
        actions.click();
        return;
      }
      // On the row's title only: on its tile, Space already ticks it.
      if (event.key === " " && target === openOf(row)) {
        const tile = row.querySelector<HTMLElement>(TILE);
        if (!tile) return;
        event.preventDefault();
        tile.dispatchEvent(
          new MouseEvent("click", { bubbles: true, shiftKey: event.shiftKey }),
        );
        return;
      }
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
      )
        return;
      const rows = rowsOf(row.parentElement);
      const to = nextEnabledIndex(
        rows.map((each) => !isEnabled(each)),
        rows.indexOf(row),
        event.key,
      );
      if (to == null) return;
      event.preventDefault();
      openOf(rows[to])?.focus();
    };

    // Firefox clicks a button on Space's keyup, whatever keydown did.
    const onKeyUp = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const row = target.closest(ROW);
      if (
        event.key === " " &&
        row &&
        target === openOf(row) &&
        row.querySelector(TILE)
      )
        event.preventDefault();
    };

    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("keyup", onKeyUp);
    return () => {
      observer.disconnect();
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("keyup", onKeyUp);
    };
  }, [rootRef]);
}
