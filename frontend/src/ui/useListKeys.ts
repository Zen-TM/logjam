import { useEffect, type RefObject } from "react";
import { nextEnabledIndex } from "./rovingFocus";

// A list of `Row`s is ONE tab stop (WAI-ARIA's roving tabindex): the row that
// last had focus keeps its title in the Tab order, and Up/Down, Home and End
// move between rows. The row's other controls stay reachable by key rather than
// by Tab: Space ticks its tile (Shift+Space a range), Enter opens it, and
// Shift+F10 or the context-menu key opens its actions. Controls a row carries
// for another reason (an Accept button) stay in the Tab order.
//
// A "list" is a `RowList` (`data-list`): the page opts in, and a row outside one
// is left exactly as it was. The attributes it reads are set by `Row`
// (`data-row`, `data-row-open`) and `RowList`.

const LIST = "[data-list]";
const ROW = "[data-row]";
const OPEN = "[data-row-open]";
const TILE = '[role="checkbox"]';
const ACTIONS = '[aria-haspopup="menu"]';

/** One polite live region for the page, made on first use. */
function announce(message: string) {
  let region = document.getElementById("list-announcer");
  if (!region) {
    region = document.createElement("div");
    region.id = "list-announcer";
    region.className = "visually-hidden";
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  region.textContent = message;
}

const rowsOf = (group: Element) =>
  Array.from(group.querySelectorAll<HTMLElement>(ROW)).filter(
    (row) => row.closest(LIST) === group && openOf(row) != null,
  );

const listOf = (row: Element) => row.closest(LIST);

const openOf = (row: Element) => row.querySelector<HTMLElement>(OPEN);

const isEnabled = (row: HTMLElement) => !openOf(row)?.hasAttribute("disabled");

export function useListKeys(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // The row each list last put focus in, so a re-render keeps its tab stop.
    const current = new WeakMap<Element, Element>();

    const sync = () => {
      for (const group of root.querySelectorAll(LIST)) {
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
            // What the keys do, for a reader who has not met them.
            const shortcuts = control.matches(OPEN)
              ? [
                  row.querySelector(TILE) && "Space",
                  row.querySelector(ACTIONS) && "Shift+F10",
                ]
              : [control.matches(TILE) ? "Space" : "Shift+F10"];
            const keys = shortcuts.filter(Boolean).join(" ");
            if (keys) control.setAttribute("aria-keyshortcuts", keys);
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
      const group = row && listOf(row);
      if (!row || !group || !openOf(row)) return;
      current.set(group, row);
      syncSoon();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>(ROW);
      const group = row && listOf(row);
      if (!row || !group || !openOf(row)) return;
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
        // Focus stays on the title, so the tick is said here.
        const name = openOf(row)?.textContent ?? "";
        setTimeout(() =>
          announce(
            `${tile.getAttribute("aria-checked") === "true" ? "Selected" : "Not selected"} ${name}`,
          ),
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
      const rows = rowsOf(group);
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
