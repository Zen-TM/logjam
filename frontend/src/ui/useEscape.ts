import { useEffect, useRef, type RefObject } from "react";

/** Escape pressed while focus is inside `ref` — for a dialog or sheet, which is
 *  not itself an interactive element and so takes no key handler of its own.
 *
 *  ONE LAYER PER PRESS: the innermost layer handles it and the press goes no
 *  further. A popover's DOM lives inside whatever opened it, so without this a
 *  colour picker's Escape bubbled on to the side sheet holding it and closed
 *  both, with focus left nowhere (DESIGN.md §10, "Escape at every layer"). */
export function useEscape(ref: RefObject<HTMLElement | null> | null, onEscape: () => void) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  useEffect(() => {
    const element = ref?.current;
    if (!element) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onEscapeRef.current();
    };
    element.addEventListener("keydown", onKeyDown);
    return () => element.removeEventListener("keydown", onKeyDown);
  }, [ref]);
}
